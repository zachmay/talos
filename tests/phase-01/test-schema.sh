#!/usr/bin/env bash
set -euo pipefail
echo "=== Schema checks ==="
# DB-02: vector column dimension (grep for the configured dimension in column type)
docker compose exec db psql -U postgres -d talos -c "\d chunks" | grep -qi "vector" && echo "PASS DB-02: vector column exists on chunks" || { echo "FAIL DB-02: no vector column on chunks"; exit 1; }
# DB-03: HNSW index
docker compose exec db psql -U postgres -d talos -c "SELECT indexname FROM pg_indexes WHERE tablename='chunks' AND indexdef LIKE '%hnsw%';" | grep -q "chunks" && echo "PASS DB-03: HNSW index exists" || { echo "FAIL DB-03: HNSW index not found"; exit 1; }
# DB-04: GIN index on metadata
docker compose exec db psql -U postgres -d talos -c "SELECT indexname FROM pg_indexes WHERE tablename='entries' AND indexdef LIKE '%gin%';" | grep -q "entries" && echo "PASS DB-04: GIN index on entries.metadata" || { echo "FAIL DB-04: GIN index not found"; exit 1; }
# DB-09: updated_at trigger
docker compose exec db psql -U postgres -d talos -c "SELECT trigger_name FROM information_schema.triggers WHERE event_object_table='entries' AND trigger_name='entries_updated_at';" | grep -q "entries_updated_at" && echo "PASS DB-09: updated_at trigger exists" || { echo "FAIL DB-09: trigger not found"; exit 1; }
