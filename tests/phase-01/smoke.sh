#!/usr/bin/env bash
set -euo pipefail
echo "=== Smoke: docker compose up and extension check ==="
docker compose up -d
docker compose ps
docker compose exec db psql -U postgres -d talos -c "SELECT extname FROM pg_extension WHERE extname='vector';" | grep -q vector && echo "PASS DB-01: pgvector extension enabled" || { echo "FAIL DB-01: vector extension not found"; exit 1; }
echo "PASS INF-01: docker compose up succeeded"
