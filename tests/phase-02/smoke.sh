#!/usr/bin/env bash
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

BASE_URL="http://localhost:3001"
AGENT_KEY=$(jq -r 'keys[0]' secrets/agent_keys.json)

pass=0
fail=0

check() {
  local name="$1" ok="$2"
  if [[ "$ok" == "true" ]]; then
    echo "  ✓ $name"
    ((pass++))
  else
    echo "  ✗ $name"
    ((fail++))
  fi
}

# Extract JSON from SSE "data:" lines
sse_json() { grep '^data: ' | sed 's/^data: //' | head -1; }

echo "=== MCP Smoke Test ==="
echo "Using key: ${AGENT_KEY:0:8}..."
echo ""

# 1. Origin rejection
echo "--- Test: Origin rejection ---"
STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Origin: http://evil.example.com" \
  -H "Authorization: Bearer $AGENT_KEY" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}')
check "Evil origin returns 403" "$([ "$STATUS" = "403" ] && echo true || echo false)"

# 2. Initialize session
echo "--- Test: Initialize ---"
INIT_RESP=$(curl -s -D /dev/stderr -X POST "$BASE_URL/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $AGENT_KEY" \
  -d '{
    "jsonrpc":"2.0","id":1,
    "method":"initialize",
    "params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke-test","version":"1.0"}}
  }' 2>/tmp/mcp-headers.txt)

SESSION_ID=$(grep -i 'mcp-session-id' /tmp/mcp-headers.txt | tr -d '\r' | awk '{print $2}')
echo "  Session: ${SESSION_ID:0:8}..."
INIT_JSON=$(echo "$INIT_RESP" | sse_json)
HAS_ERROR=$(echo "$INIT_JSON" | jq 'has("error")')
check "Initialize succeeds" "$([ "$HAS_ERROR" = "false" ] && echo true || echo false)"

# Send initialized notification
curl -s -o /dev/null -X POST "$BASE_URL/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $AGENT_KEY" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'

# 3. Insert
echo "--- Test: Insert ---"
INSERT_RESP=$(curl -s -X POST "$BASE_URL/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $AGENT_KEY" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{
    "jsonrpc":"2.0","id":2,
    "method":"tools/call",
    "params":{"name":"insert","arguments":{"content":"Talos MCP smoke test entry","path":["test","smoke"]}}
  }')

INSERT_JSON=$(echo "$INSERT_RESP" | sse_json)
HAS_ERROR=$(echo "$INSERT_JSON" | jq 'has("error")')
check "Insert succeeds" "$([ "$HAS_ERROR" = "false" ] && echo true || echo false)"

# 3. Search
echo "--- Test: Search ---"
SEARCH_RESP=$(curl -s -X POST "$BASE_URL/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $AGENT_KEY" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{
    "jsonrpc":"2.0","id":3,
    "method":"tools/call",
    "params":{"name":"search","arguments":{"query":"Talos MCP smoke test","verbose":true,"threshold":0.5}}
  }')

SEARCH_JSON=$(echo "$SEARCH_RESP" | sse_json)
RESULT_TEXT=$(echo "$SEARCH_JSON" | jq -r '.result.content[0].text // ""' 2>/dev/null || echo "")
HAS_RESULTS=$([ -n "$RESULT_TEXT" ] && [ "$RESULT_TEXT" != "" ] && echo true || echo false)
check "Search returns results" "$HAS_RESULTS"

FOUND_ENTRY=$(echo "$RESULT_TEXT" | grep -qi "smoke" && echo true || echo false)
check "Search finds inserted entry" "$FOUND_ENTRY"

# Summary
echo ""
echo "=== Results: $pass passed, $fail failed ==="
rm -f /tmp/mcp-headers.txt
[ "$fail" -eq 0 ] && exit 0 || exit 1
