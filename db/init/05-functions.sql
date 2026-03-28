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
-- match_threshold: cosine similarity threshold (0.0-1.0, higher = stricter)
-- filter_metadata: optional JSONB containment filter on entries.metadata
CREATE OR REPLACE FUNCTION match_entries(
    query_embedding   VECTOR,
    match_threshold   FLOAT   DEFAULT 0.7,
    match_count       INT     DEFAULT 10,
    filter_metadata   JSONB   DEFAULT NULL
)
RETURNS TABLE (
    id          UUID,
    content     TEXT,
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
        e.content,
        e.metadata,
        e.agent_id,
        (1 - (c.embedding <=> query_embedding))::FLOAT AS similarity
    FROM chunks c
    JOIN entries e ON c.entry_id = e.id
    WHERE (1 - (c.embedding <=> query_embedding)) >= match_threshold
      AND (filter_metadata IS NULL OR e.metadata @> filter_metadata)
    ORDER BY e.id, c.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
