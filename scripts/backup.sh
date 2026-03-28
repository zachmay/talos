#!/usr/bin/env bash
# scripts/backup.sh — Create a compressed Postgres backup via docker compose exec
# Usage: ./talos backup [--retention N]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUPS_DIR="$PROJECT_ROOT/backups"
RETENTION=7  # default: keep last 7 backups

while [[ $# -gt 0 ]]; do
  case "$1" in
    --retention) RETENTION="$2"; shift 2 ;;
    --dry-run)   DRY_RUN=1; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

mkdir -p "$BACKUPS_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUPS_DIR/talos_${TIMESTAMP}.dump"

if [[ "${DRY_RUN:-0}" -eq 1 ]]; then
  echo "[DRY RUN] Would write: $BACKUP_FILE"
  exit 0
fi

echo "Creating backup: $BACKUP_FILE"
docker compose -f "$PROJECT_ROOT/docker-compose.yml" exec -T db \
  pg_dump -U postgres -Fc talos > "$BACKUP_FILE"

# Verify the backup file is non-empty (basic sanity check)
if [[ ! -s "$BACKUP_FILE" ]]; then
  echo "[ERROR] Backup file is empty — pg_dump may have failed"
  rm -f "$BACKUP_FILE"
  exit 1
fi

echo "[OK] Backup written: $BACKUP_FILE ($(du -sh "$BACKUP_FILE" | cut -f1))"

# Retention enforcement: delete oldest backups beyond limit
# Run AFTER confirming new backup is good
EXCESS=$(ls -t "$BACKUPS_DIR"/talos_*.dump 2>/dev/null | tail -n +$((RETENTION + 1)))
if [[ -n "$EXCESS" ]]; then
  while IFS= read -r f; do
    echo "  removed: $(basename "$f")"
    rm -- "$f"
  done <<< "$EXCESS"
  echo "[OK] Retention enforced: kept last $RETENTION backups"
fi
