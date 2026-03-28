#!/usr/bin/env bash
# scripts/health.sh — End-to-end Talos health check
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE="docker compose -f $PROJECT_ROOT/docker-compose.yml"

PASS=0
FAIL=0

check() {
  local label="$1"; shift
  if "$@" &>/dev/null; then
    echo "[PASS] $label"
    PASS=$((PASS + 1))
  else
    echo "[FAIL] $label"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== Talos Health Check ==="

# DB checks
check "DB is reachable"        $COMPOSE exec -T db pg_isready -U postgres
check "pgvector extension"     bash -c "$COMPOSE exec -T db psql -U postgres -d talos -tAc \"SELECT 1 FROM pg_extension WHERE extname='vector'\" | grep -q 1"
check "RLS on entries"         bash -c "$COMPOSE exec -T db psql -U postgres -d talos -tAc \"SELECT rowsecurity FROM pg_tables WHERE tablename='entries'\" | grep -q t"
check "RLS on audit_log"       bash -c "$COMPOSE exec -T db psql -U postgres -d talos -tAc \"SELECT rowsecurity FROM pg_tables WHERE tablename='audit_log'\" | grep -q t"
check "match_entries function"  bash -c "$COMPOSE exec -T db psql -U postgres -d talos -tAc \"SELECT 1 FROM pg_proc WHERE proname='match_entries'\" | grep -q 1"
check "audit_log table"        bash -c "$COMPOSE exec -T db psql -U postgres -d talos -tAc \"SELECT 1 FROM information_schema.tables WHERE table_name='audit_log'\" | grep -q 1"

# MCP checks
check "MCP container running"  bash -c "$COMPOSE ps mcp | grep -qE 'Up|running'"

# Compose portability (static check — does not require running stack)
check "No host.docker.internal in default compose" \
  bash -c "! grep -q 'host.docker.internal' '$PROJECT_ROOT/docker-compose.yml'"

# Disk usage for backups dir
BACKUPS_DIR="$PROJECT_ROOT/backups"
if [[ -d "$BACKUPS_DIR" ]]; then
  DISK=$(df -h "$BACKUPS_DIR" | awk 'NR==2 {print $5}' | tr -d '%')
  if [[ -n "$DISK" && "$DISK" -lt 80 ]]; then
    echo "[PASS] Backup disk usage: ${DISK}%"
    ((PASS++))
  else
    echo "[WARN] Backup disk usage: ${DISK}% (above 80%)"
  fi
fi

# Network posture summary (lightweight — full analysis: ./talos network-audit)
echo ""
echo "=== Network Posture ==="
check "Agent cannot reach DB directly" \
  bash -c "! $COMPOSE exec -T agent sh -c 'nc -z db 5432 2>/dev/null'"
echo "    (run './talos network-audit' for full exposure analysis)"

echo ""
echo "Result: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
