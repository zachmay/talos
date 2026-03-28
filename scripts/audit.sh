#!/usr/bin/env bash
# scripts/audit.sh — Query audit_log with filters
# Runs as postgres superuser (bypasses RLS); use --agent for per-agent views.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE="docker compose -f $PROJECT_ROOT/docker-compose.yml"

AGENT=""
OPERATION=""
SINCE=""
UNTIL=""
ENTRY_ID=""
FORMAT="table"
LIMIT=100

while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent)     AGENT="$2";     shift 2 ;;
    --operation) OPERATION="$2"; shift 2 ;;
    --since)     SINCE="$2";     shift 2 ;;
    --until)     UNTIL="$2";     shift 2 ;;
    --entry)     ENTRY_ID="$2";  shift 2 ;;
    --format)    FORMAT="$2";    shift 2 ;;
    --limit)     LIMIT="$2";     shift 2 ;;
    --help)
      echo "Usage: ./talos audit [options]"
      echo ""
      echo "Options:"
      echo "  --agent <id>        Filter by agent ID"
      echo "  --operation <type>  Filter by operation (insert, update, delete)"
      echo "  --since <timestamp> Filter entries after timestamp"
      echo "  --until <timestamp> Filter entries before timestamp"
      echo "  --entry <uuid>      Filter by target entry ID"
      echo "  --format <fmt>      Output format: table (default) or json"
      echo "  --limit <n>         Max rows to return (default: 100)"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Build WHERE clause dynamically
CONDITIONS=""
add_condition() {
  if [[ -n "$CONDITIONS" ]]; then CONDITIONS="$CONDITIONS AND $1"; else CONDITIONS="WHERE $1"; fi
}

[[ -n "$AGENT" ]]     && add_condition "agent_id = '$AGENT'"
[[ -n "$OPERATION" ]] && add_condition "operation = '$OPERATION'"
[[ -n "$SINCE" ]]     && add_condition "created_at >= '$SINCE'"
[[ -n "$UNTIL" ]]     && add_condition "created_at <= '$UNTIL'"
[[ -n "$ENTRY_ID" ]]  && add_condition "target_id = '$ENTRY_ID'"

SQL="SELECT id, agent_id, operation, target_id, created_at, details FROM audit_log $CONDITIONS ORDER BY created_at DESC LIMIT $LIMIT;"

if [[ "$FORMAT" == "json" ]]; then
  $COMPOSE exec -T db psql -U postgres -d talos -tAc \
    "SELECT json_agg(t) FROM ($SQL) t;"
else
  $COMPOSE exec -T db psql -U postgres -d talos -c "$SQL"
fi
