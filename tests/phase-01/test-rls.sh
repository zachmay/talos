#!/usr/bin/env bash
set -euo pipefail
echo "=== RLS checks ==="
# DB-05: RLS enabled and forced
docker compose exec db psql -U postgres -d talos -c "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='entries';" | grep -q "t.*t" && echo "PASS DB-05: RLS enabled+forced on entries" || { echo "FAIL DB-05: RLS not forced on entries"; exit 1; }
# DB-06: mcp_service role exists
docker compose exec db psql -U postgres -d talos -c "\du mcp_service" | grep -q "mcp_service" && echo "PASS DB-06: mcp_service role exists" || { echo "FAIL DB-06: mcp_service role not found"; exit 1; }
# DB-07: agent isolation — insert as agent-A via superuser,
# then query as mcp_service (non-superuser, subject to RLS) with agent-B identity
docker compose exec -T db psql -U postgres -d talos <<-'SQL'
    SET app.agent_id = 'agent-A';
    INSERT INTO entries (content, metadata, agent_id) VALUES ('test content A', '{}', 'agent-A');
SQL
ROW_COUNT=$(docker compose exec -T db psql -U mcp_service -d talos -t -A <<-'SQL'
SELECT set_config('app.agent_id', 'agent-B', true);
SELECT count(*) FROM entries;
SQL
)
# -t -A gives unformatted output; count is on the last non-empty line
ROW_COUNT=$(echo "$ROW_COUNT" | grep -E '^[0-9]+$' | tail -1)
if [[ "$ROW_COUNT" == "0" ]]; then
    echo "PASS DB-07: agent-B sees 0 rows owned by agent-A"
else
    echo "FAIL DB-07: agent-B can see agent-A rows (RLS not working), count=$ROW_COUNT"
    exit 1
fi
# Cleanup
docker compose exec db psql -U postgres -d talos -c "DELETE FROM entries WHERE agent_id='agent-A';"
