#!/usr/bin/env bash
# scripts/restore.sh — Restore Postgres and/or MongoDB from backup files
# Usage: ./talos restore <pg-dump-file> [--mongo <mongo-archive>] [--verify-only]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE="docker compose -f $PROJECT_ROOT/docker-compose.yml"

PG_FILE="${1:-}"
MONGO_FILE=""
VERIFY_ONLY=0

shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --mongo) MONGO_FILE="$2"; shift 2 ;;
    --verify-only) VERIFY_ONLY=1; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [[ -z "$PG_FILE" ]]; then
  echo "Usage: ./talos restore <pg-dump-file> [--mongo <mongo-archive>] [--verify-only]"
  echo ""
  echo "Examples:"
  echo "  ./talos restore backups/talos_20260331.dump"
  echo "  ./talos restore backups/talos_20260331.dump --mongo backups/mongo_20260331.archive"
  echo "  ./talos restore backups/talos_20260331.dump --verify-only"
  exit 1
fi

if [[ ! -f "$PG_FILE" ]]; then
  echo "[ERROR] Postgres backup not found: $PG_FILE"
  exit 1
fi

if [[ -n "$MONGO_FILE" && ! -f "$MONGO_FILE" ]]; then
  echo "[ERROR] MongoDB backup not found: $MONGO_FILE"
  exit 1
fi

verify_restore() {
  echo "--- Verifying Postgres ---"

  $COMPOSE exec -T db \
    psql -U postgres -d talos -tAc \
    "SELECT extname FROM pg_extension WHERE extname = 'vector';" | grep -q vector
  echo "[OK] pgvector extension present"

  COUNT=$($COMPOSE exec -T db \
    psql -U postgres -d talos -tAc "SELECT COUNT(*) FROM entries;")
  echo "[OK] entries table: $COUNT rows"

  $COMPOSE exec -T db \
    psql -U postgres -d talos -tAc \
    "SELECT proname FROM pg_proc WHERE proname = 'match_entries';" | grep -q match_entries
  echo "[OK] match_entries function present"

  if [[ -n "$MONGO_FILE" ]]; then
    echo "--- Verifying MongoDB ---"
    COLLECTIONS=$($COMPOSE exec -T mongodb mongosh --quiet librechat --eval "db.getCollectionNames().length")
    echo "[OK] MongoDB collections: $COLLECTIONS"
  fi

  echo "--- Verification complete ---"
}

if [[ "$VERIFY_ONLY" -eq 1 ]]; then
  verify_restore
  exit 0
fi

echo "Restoring from: $PG_FILE"
[[ -n "$MONGO_FILE" ]] && echo "MongoDB from: $MONGO_FILE"
echo "[WARN] This will overwrite existing data. Services will be stopped."

# Stop services that hold connections
$COMPOSE stop mcp librechat 2>/dev/null || true

# Restore Postgres
echo "Restoring Postgres..."
$COMPOSE exec -T db \
  pg_restore -U postgres --clean --if-exists -d talos < "$PG_FILE"
echo "[OK] Postgres restored"

# Restore MongoDB
if [[ -n "$MONGO_FILE" ]]; then
  echo "Restoring MongoDB..."
  $COMPOSE exec -T mongodb mongorestore --db=librechat --archive --drop --quiet < "$MONGO_FILE"
  echo "[OK] MongoDB restored"
fi

# Restart services
$COMPOSE start mcp librechat 2>/dev/null || true

verify_restore
