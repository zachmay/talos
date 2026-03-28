-- Phase 4: Audit logging schema
-- Numbered 07 to run after existing Phase 1 init scripts (00-06)

CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL    PRIMARY KEY,
  agent_id    TEXT         NOT NULL,
  operation   TEXT         NOT NULL CHECK (operation IN ('insert', 'update', 'delete')),
  target_id   UUID,
  details     JSONB        NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_agent_idx      ON audit_log (agent_id);
CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_target_idx     ON audit_log (target_id) WHERE target_id IS NOT NULL;

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

-- Agents may only read their own audit trail
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'audit_log' AND policyname = 'audit_log_select_isolation'
  ) THEN
    CREATE POLICY audit_log_select_isolation ON audit_log
      FOR SELECT
      USING (agent_id = current_setting('app.agent_id', true));
  END IF;
END $$;

-- mcp_service cannot write audit entries for a different agent
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'audit_log' AND policyname = 'audit_log_insert_check'
  ) THEN
    CREATE POLICY audit_log_insert_check ON audit_log
      FOR INSERT
      WITH CHECK (agent_id = current_setting('app.agent_id', true));
  END IF;
END $$;

GRANT SELECT, INSERT ON audit_log TO mcp_service;
GRANT USAGE, SELECT ON SEQUENCE audit_log_id_seq TO mcp_service;
