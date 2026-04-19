-- Trigger function: auto-update entries.updated_at on row modification.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER entries_updated_at
    BEFORE UPDATE ON entries
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Semantic search function.
-- SECURITY INVOKER (default): runs as the calling role (mcp_service),
-- so RLS on chunks and entries enforces agent isolation automatically.
-- No explicit agent_id filter needed here — RLS handles it.
--
-- Filters:
--   match_threshold:   cosine similarity threshold (0.0-1.0, higher = stricter)
--   filter_title:      exact-match title column
--   filter_type:       exact-match type column
--   filter_mime_type:  exact-match mime_type column
--   filter_metadata:   JSONB containment against the metadata column
--   filter_path:       array-containment path filter
CREATE OR REPLACE FUNCTION match_entries(
    query_embedding   VECTOR,
    match_threshold   FLOAT   DEFAULT 0.7,
    match_count       INT     DEFAULT 10,
    filter_metadata   JSONB   DEFAULT NULL,
    filter_path       TEXT[]  DEFAULT NULL,
    filter_title      TEXT    DEFAULT NULL,
    filter_type       TEXT    DEFAULT NULL,
    filter_mime_type  TEXT    DEFAULT NULL
)
RETURNS TABLE (
    id          UUID,
    title       TEXT,
    type        TEXT,
    mime_type   TEXT,
    content     TEXT,
    path        TEXT[],
    metadata    JSONB,
    agent_id    TEXT,
    similarity  FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT DISTINCT ON (e.id)
        e.id,
        e.title,
        e.type,
        e.mime_type,
        e.content,
        e.path,
        e.metadata,
        e.agent_id,
        (1 - (c.embedding <=> query_embedding))::FLOAT AS similarity
    FROM chunks c
    JOIN entries e ON c.entry_id = e.id
    WHERE (1 - (c.embedding <=> query_embedding)) >= match_threshold
      AND (filter_metadata IS NULL OR e.metadata @> filter_metadata)
      AND (filter_path     IS NULL OR e.path     @> filter_path)
      AND (filter_title    IS NULL OR e.title      = filter_title)
      AND (filter_type     IS NULL OR e.type       = filter_type)
      AND (filter_mime_type IS NULL OR e.mime_type = filter_mime_type)
    ORDER BY e.id, c.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
