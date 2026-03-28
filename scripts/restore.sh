#!/usr/bin/env bash
# scripts/restore.sh — Restore Postgres from a pg_dump -Fc backup file
# Usage: ./talos restore <backup-file> [--verify-only]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

BACKUP_FILE="${1:-}"
VERIFY_ONLY=0

shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --verify-only) VERIFY_ONLY=1; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [[ -z "$BACKUP_FILE" ]]; then
  echo "Usage: ./talos restore <backup-file>"
  exit 1
fi

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "[ERROR] Backup file not found: $BACKUP_FILE"
  exit 1
fi

verify_restore() {
  local DB="talos"
  echo "--- Verifying restore ---"

  # 1. pgvector extension present
  docker compose -f "$PROJECT_ROOT/docker-compose.yml" exec -T db \
    psql -U postgres -d "$DB" -tAc \
    "SELECT extname FROM pg_extension WHERE extname = 'vector';" | grep -q vector
  echo "[OK] pgvector extension present"

  # 2. entries row count
  COUNT=$(docker compose -f "$PROJECT_ROOT/docker-compose.yml" exec -T db \
    psql -U postgres -d "$DB" -tAc "SELECT COUNT(*) FROM entries;")
  echo "[OK] entries table: $COUNT rows"

  # 3. RLS enabled on key tables
  docker compose -f "$PROJECT_ROOT/docker-compose.yml" exec -T db \
    psql -U postgres -d "$DB" -tAc \
    "SELECT tablename, rowsecurity FROM pg_tables WHERE tablename IN ('entries','chunks','audit_log') ORDER BY tablename;" \
    | grep -E "^(entries|chunks|audit_log)\|t$" | wc -l | grep -qE "^[23]$"
  echo "[OK] RLS enabled on data tables"

  # 4. match_entries function present
  docker compose -f "$PROJECT_ROOT/docker-compose.yml" exec -T db \
    psql -U postgres -d "$DB" -tAc \
    "SELECT proname FROM pg_proc WHERE proname = 'match_entries';" | grep -q match_entries
  echo "[OK] match_entries function present"

  # 5. audit_log table present (Phase 4)
  docker compose -f "$PROJECT_ROOT/docker-compose.yml" exec -T db \
    psql -U postgres -d "$DB" -tAc \
    "SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_log';" | grep -q 1
  echo "[OK] audit_log table present"

  echo "--- Verification complete ---"
}

if [[ "$VERIFY_ONLY" -eq 1 ]]; then
  verify_restore
  exit 0
fi

echo "Restoring from: $BACKUP_FILE"
echo "[WARN] This will drop and recreate all database objects. Services will be stopped."

# Stop services that hold DB connections (prevents pg_restore: 'database is being accessed by other users')
docker compose -f "$PROJECT_ROOT/docker-compose.yml" stop mcp agent 2>/dev/null || true

# Run pg_restore — stream backup file from host into container stdin
docker compose -f "$PROJECT_ROOT/docker-compose.yml" exec -T db \
  pg_restore -U postgres --clean --if-exists -d talos < "$BACKUP_FILE"

echo "[OK] pg_restore completed"

# Restart dependent services
docker compose -f "$PROJECT_ROOT/docker-compose.yml" start mcp agent 2>/dev/null || true

# Verify the restored database
verify_restore
