#!/usr/bin/env bash
# scripts/backup.sh — Create compressed backups of Postgres and MongoDB
# Usage: ./talos backup [--retention N] [--db-only] [--mongo-only]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUPS_DIR="$PROJECT_ROOT/backups"
RETENTION=7
DRY_RUN=0
DB_ONLY=0
MONGO_ONLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --retention) RETENTION="$2"; shift 2 ;;
    --dry-run)   DRY_RUN=1; shift ;;
    --db-only)   DB_ONLY=1; shift ;;
    --mongo-only) MONGO_ONLY=1; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

mkdir -p "$BACKUPS_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
COMPOSE="docker compose -f $PROJECT_ROOT/docker-compose.yml"

FAILED=0

# --- Postgres backup ---
if [[ "$MONGO_ONLY" -eq 0 ]]; then
  PG_FILE="$BACKUPS_DIR/talos_${TIMESTAMP}.dump"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[DRY RUN] Would write: $PG_FILE"
  else
    echo "Backing up Postgres..."
    $COMPOSE exec -T db pg_dump -U postgres -Fc talos > "$PG_FILE"
    if [[ ! -s "$PG_FILE" ]]; then
      echo "[ERROR] Postgres backup file is empty"
      rm -f "$PG_FILE"
      FAILED=1
    else
      echo "[OK] Postgres: $PG_FILE ($(du -sh "$PG_FILE" | cut -f1))"
    fi
  fi
fi

# --- MongoDB backup ---
if [[ "$DB_ONLY" -eq 0 ]]; then
  MONGO_FILE="$BACKUPS_DIR/mongo_${TIMESTAMP}.archive"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[DRY RUN] Would write: $MONGO_FILE"
  else
    echo "Backing up MongoDB..."
    $COMPOSE exec -T mongodb mongodump --db=librechat --archive --quiet > "$MONGO_FILE"
    if [[ ! -s "$MONGO_FILE" ]]; then
      echo "[ERROR] MongoDB backup file is empty"
      rm -f "$MONGO_FILE"
      FAILED=1
    else
      echo "[OK] MongoDB: $MONGO_FILE ($(du -sh "$MONGO_FILE" | cut -f1))"
    fi
  fi
fi

# --- Retention enforcement ---
if [[ "$DRY_RUN" -eq 0 ]]; then
  for pattern in "talos_*.dump" "mongo_*.archive"; do
    EXCESS=$(ls -t "$BACKUPS_DIR"/$pattern 2>/dev/null | tail -n +$((RETENTION + 1)))
    if [[ -n "$EXCESS" ]]; then
      while IFS= read -r f; do
        echo "  removed: $(basename "$f")"
        rm -- "$f"
      done <<< "$EXCESS"
    fi
  done
  echo "[OK] Retention enforced: kept last $RETENTION of each"
fi

[[ "$FAILED" -eq 0 ]] && exit 0 || exit 1
