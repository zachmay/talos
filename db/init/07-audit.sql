-- Phase 4: Audit logging schema
-- Numbered 07 to run after existing Phase 1 init scripts (00-06)
--
-- DESIGN CONSTRAINT: Audit is trigger-based and completely invisible to
-- mcp_service / agents. No SELECT, INSERT, UPDATE, or DELETE granted.
-- Only superuser/admin can query audit_log.

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

-- No RLS policies for mcp_service — it has zero access.
-- If admin access is needed, connect as superuser (bypasses RLS).

-- Trigger function: auto-log mutations on entries table
CREATE OR REPLACE FUNCTION audit_entries_trigger() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO audit_log (agent_id, operation, target_id, details)
    VALUES (
      coalesce(current_setting('app.agent_id', true), OLD.agent_id),
      'delete',
      OLD.id,
      jsonb_build_object('table', 'entries')
    );
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_log (agent_id, operation, target_id, details)
    VALUES (
      coalesce(current_setting('app.agent_id', true), NEW.agent_id),
      'update',
      NEW.id,
      jsonb_build_object('table', 'entries')
    );
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log (agent_id, operation, target_id, details)
    VALUES (
      coalesce(current_setting('app.agent_id', true), NEW.agent_id),
      'insert',
      NEW.id,
      jsonb_build_object('table', 'entries')
    );
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS entries_audit_trigger ON entries;
CREATE TRIGGER entries_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON entries
  FOR EACH ROW EXECUTE FUNCTION audit_entries_trigger();

-- Explicitly revoke everything from mcp_service
REVOKE ALL ON audit_log FROM mcp_service;
REVOKE ALL ON SEQUENCE audit_log_id_seq FROM mcp_service;
