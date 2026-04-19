-- Links table: typed, directional graph edges between entries.
-- Populated by Pass 2 link resolution during import; maintained by
-- insert/update tool hooks afterward.

CREATE TYPE link_type AS ENUM ('wikilink', 'tag', 'embed', 'mention');

CREATE TABLE links (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id    TEXT        NOT NULL,
    source_id   UUID        NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    target_id   UUID        REFERENCES entries(id) ON DELETE SET NULL,
    link_text   TEXT        NOT NULL,
    link_type   link_type   NOT NULL,
    candidates  UUID[],                          -- IMPORT-ONLY column (dropped after Pass 2)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT links_resolved_no_candidates
        CHECK (target_id IS NULL OR candidates IS NULL),
    CONSTRAINT links_ambiguous_has_candidates
        CHECK (target_id IS NOT NULL OR candidates IS NULL OR array_length(candidates, 1) >= 2),
    CONSTRAINT links_unique_edge
        UNIQUE (source_id, link_type, link_text)
);

CREATE INDEX links_source_idx ON links (source_id);
CREATE INDEX links_target_idx ON links (target_id) WHERE target_id IS NOT NULL;
CREATE INDEX links_type_idx ON links (link_type);
CREATE INDEX links_unresolved_idx ON links (source_id) WHERE target_id IS NULL;

ALTER TABLE links ENABLE ROW LEVEL SECURITY;
ALTER TABLE links FORCE ROW LEVEL SECURITY;

CREATE POLICY links_agent_isolation ON links
    USING (agent_id = current_setting('app.agent_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON links TO mcp_service;
