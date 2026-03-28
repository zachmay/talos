#!/usr/bin/env bash
set -euo pipefail
echo "=== Secrets inspection check ==="
INSPECT_OUTPUT=$(docker inspect $(docker compose ps -q) 2>/dev/null)
# Capture lines that look like secret values, excluding acceptable _FILE / /run/secrets references.
SUSPECTS=$(echo "$INSPECT_OUTPUT" | grep -iE 'password|api_key' | grep -vE '_FILE|/run/secrets' || true)
if [[ -z "$SUSPECTS" ]]; then
    echo "PASS INF-03: No plaintext secrets in docker inspect output"
    echo "  (PASSWORD_FILE references are acceptable — they point to secret mounts, not values)"
else
    echo "FAIL INF-03: Potential secret value found in docker inspect output"
    echo "$SUSPECTS"
    exit 1
fi
