-- Enable and FORCE RLS on both tables.
-- FORCE ensures even the table owner (postgres) is subject to policies.
ALTER TABLE entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE entries FORCE ROW LEVEL SECURITY;
ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks FORCE ROW LEVEL SECURITY;

-- Per-agent policies. current_setting('app.agent_id', true):
-- - missing_ok=true: returns NULL if not set (unset agent sees zero rows — correct behavior)
-- - MCP server sets this with set_config('app.agent_id', $agent_id, true) before each query
-- - is_local=true in set_config means value resets after transaction (no bleed between requests)
CREATE POLICY entries_agent_isolation ON entries
    USING (agent_id = current_setting('app.agent_id', true));

CREATE POLICY chunks_agent_isolation ON chunks
    USING (agent_id = current_setting('app.agent_id', true));

-- DML grants on tables (tables must exist before granting)
GRANT SELECT, INSERT, UPDATE, DELETE ON entries TO mcp_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON chunks TO mcp_service;

-- EXECUTE grant on search function
GRANT EXECUTE ON FUNCTION match_entries(VECTOR, FLOAT, INT, JSONB, TEXT[], TEXT, TEXT, TEXT) TO mcp_service;
