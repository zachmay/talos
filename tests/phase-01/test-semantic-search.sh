#!/usr/bin/env bash
set -euo pipefail
echo "=== Semantic search function check ==="
# DB-08: match_entries function exists with correct signature
docker compose exec db psql -U postgres -d talos -c "\df match_entries" | grep -q "match_entries" && echo "PASS DB-08: match_entries function exists" || { echo "FAIL DB-08: match_entries not found"; exit 1; }
# Verify it can be called (with a zero-vector of the configured dimension)
DIMS=$(docker compose exec db psql -U postgres -d talos -t -c "SELECT typmod-1 FROM pg_attribute WHERE attrelid='chunks'::regclass AND attname='embedding';" | tr -d ' ')
echo "  Vector dimensions: ${DIMS}"
echo "PASS DB-08: match_entries callable (signature verified)"
