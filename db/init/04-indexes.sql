-- HNSW index on chunks.embedding for fast cosine ANN search.
-- m=16, ef_construction=64: safe defaults; tune after load testing.
CREATE INDEX ON chunks USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- GIN index on entries.metadata for fast @> containment queries.
-- Supports arbitrary key filtering without knowing keys at index time.
CREATE INDEX ON entries USING gin (metadata);

-- GIN index on entries.path for fast @> array containment queries.
CREATE INDEX ON entries USING gin (path);
