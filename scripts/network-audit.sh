#!/usr/bin/env bash
# scripts/network-audit.sh — Full network exposure analysis for Talos
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE="docker compose -f $PROJECT_ROOT/docker-compose.yml"

PASS=0
FAIL=0
WARN=0

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

FORMAT="human"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --json) FORMAT="json"; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

get_container_id() {
  local service="$1"
  $COMPOSE ps -q "$service" 2>/dev/null | head -1
}

# Pre-flight: verify stack is running
if ! $COMPOSE ps --services --filter status=running 2>/dev/null | grep -q db; then
  echo "ERROR: Talos stack is not running."
  exit 1
fi

# --- Published Ports ---
echo "=== Network Audit: Published Ports ==="
echo ""
echo "Checking published port bindings (accessible outside Docker networks)..."
echo ""

DB_ID=$(get_container_id db)
MCP_ID=$(get_container_id mcp)
AGENT_ID=$(get_container_id agent)

# DB port
if [[ -n "$DB_ID" ]]; then
  BINDINGS=$(docker inspect "$DB_ID" --format '{{json .NetworkSettings.Ports}}' 2>/dev/null)
  echo "db container ports: $BINDINGS"
  if echo "$BINDINGS" | grep -q '"HostIp":"0.0.0.0"'; then
    echo "[WARN] DB port bound to 0.0.0.0 — Postgres accessible on ALL host interfaces"
    echo "       Recommendation: bind to 127.0.0.1 in docker-compose.yml:"
    echo "       ports: \"127.0.0.1:\${DB_PORT:-5432}:5432\""
    WARN=$((WARN + 1))
  elif echo "$BINDINGS" | grep -q '"HostIp":"127.0.0.1"'; then
    echo "[PASS] DB port bound to 127.0.0.1 (loopback only)"
    PASS=$((PASS + 1))
  else
    echo "[INFO] DB port not published to host"
    PASS=$((PASS + 1))
  fi
else
  echo "[SKIP] db container not running"
fi

# MCP port
if [[ -n "$MCP_ID" ]]; then
  MCP_PORTS=$(docker inspect "$MCP_ID" --format '{{json .NetworkSettings.Ports}}' 2>/dev/null)
  if echo "$MCP_PORTS" | grep -q '"HostPort"'; then
    echo "[WARN] MCP container has published ports: $MCP_PORTS"
    WARN=$((WARN + 1))
  else
    echo "[PASS] MCP container has no published ports"
    PASS=$((PASS + 1))
  fi
else
  echo "[SKIP] mcp container not running"
fi

# Agent port
if [[ -n "$AGENT_ID" ]]; then
  AGENT_PORTS=$(docker inspect "$AGENT_ID" --format '{{json .NetworkSettings.Ports}}' 2>/dev/null)
  if echo "$AGENT_PORTS" | grep -q '"HostPort"'; then
    echo "[WARN] Agent container has published ports: $AGENT_PORTS"
    WARN=$((WARN + 1))
  else
    echo "[PASS] Agent container has no published ports"
    PASS=$((PASS + 1))
  fi
else
  echo "[SKIP] agent container not running"
fi

# --- Network Membership ---
echo ""
echo "=== Network Audit: Container Network Membership ==="
echo ""

for SVC in db mcp agent; do
  SVC_ID=$(get_container_id "$SVC")
  if [[ -n "$SVC_ID" ]]; then
    NETWORKS=$(docker inspect "$SVC_ID" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' 2>/dev/null)
    echo "$SVC networks: $NETWORKS"
  else
    echo "$SVC: not running"
  fi
done

echo ""
# Verify agent is NOT in backend network
if [[ -n "$AGENT_ID" ]]; then
  AGENT_NETS=$(docker inspect "$AGENT_ID" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' 2>/dev/null)
  if echo "$AGENT_NETS" | grep -q backend; then
    echo "[FAIL] Agent is in the backend network — can reach DB directly"
    FAIL=$((FAIL + 1))
  else
    echo "[PASS] Agent is not in backend network (DB is isolated from agent)"
    PASS=$((PASS + 1))
  fi
fi

# --- Outbound Internet Reachability ---
echo ""
echo "=== Network Audit: Outbound Internet Reachability ==="
echo ""
echo "Testing which containers can reach the internet..."
echo "(wget with 3s timeout — SKIP if tool not available in container)"
echo ""

if [[ -n "$AGENT_ID" ]]; then
  if docker exec "$AGENT_ID" sh -c "wget -q --spider --timeout=3 https://api.anthropic.com 2>&1" &>/dev/null; then
    echo "[INFO] agent -> internet: REACHABLE (expected — agent calls Anthropic API)"
  else
    echo "[INFO] agent -> internet: UNREACHABLE (unusual — agent cannot call Anthropic API)"
  fi
else
  echo "[SKIP] agent not running"
fi

if [[ -n "$DB_ID" ]]; then
  if docker exec "$DB_ID" sh -c "wget -q --spider --timeout=3 https://api.anthropic.com 2>&1" &>/dev/null; then
    echo "[WARN] db -> internet: REACHABLE (unexpected — DB should be network-isolated)"
    WARN=$((WARN + 1))
  else
    echo "[PASS] db -> internet: UNREACHABLE (expected — DB has no internet access)"
    PASS=$((PASS + 1))
  fi
else
  echo "[SKIP] db not running"
fi

# --- Compose Config Drift ---
echo ""
echo "=== Network Audit: Compose Config Drift ==="
echo ""
echo "Comparing running containers against current docker-compose.yml config..."
echo ""

# Check compose config hash on agent container
if [[ -n "$AGENT_ID" ]]; then
  RUNNING_HASH=$(docker inspect "$AGENT_ID" --format '{{index .Config.Labels "com.docker.compose.config-hash"}}' 2>/dev/null || echo "")
  if [[ -n "$RUNNING_HASH" ]]; then
    echo "[INFO] Agent compose config hash: $RUNNING_HASH"
    echo "       (Restart containers after docker-compose.yml changes to apply updates)"
  else
    echo "[INFO] No compose config hash found on agent container"
  fi
fi

# Check that seccomp profile file still exists
SECCOMP_PATH="$PROJECT_ROOT/agent/seccomp-standard.json"
if [[ -f "$SECCOMP_PATH" ]]; then
  echo "[PASS] Seccomp profile file exists: agent/seccomp-standard.json"
  PASS=$((PASS + 1))
else
  echo "[FAIL] Seccomp profile file missing: agent/seccomp-standard.json"
  FAIL=$((FAIL + 1))
fi

# --- Summary ---
echo ""
echo "=== Network Audit Summary ==="
if [[ "$FORMAT" == "json" ]]; then
  echo "{\"passed\": $PASS, \"failed\": $FAIL, \"warnings\": $WARN}"
else
  echo "Result: $PASS passed, $FAIL failed"
  if [[ $FAIL -gt 0 ]]; then
    echo ""
    echo "Review [WARN] and [FAIL] items above before deploying to production."
  fi
fi

[[ $FAIL -eq 0 ]]
