-- Schema template. 00-configure.sh substitutes ${VECTOR_DIMENSIONS} before this runs.
-- DO NOT reference this file directly from Postgres — reference 03-schema.sql (generated).

CREATE TABLE entries (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    content     TEXT        NOT NULL,
    path        TEXT[]      NOT NULL DEFAULT '{}',
    metadata    JSONB       NOT NULL DEFAULT '{}',
    agent_id    TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE chunks (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id    UUID        NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    chunk_idx   INT         NOT NULL,
    chunk_text  TEXT        NOT NULL,
    embedding   VECTOR(${VECTOR_DIMENSIONS}),
    agent_id    TEXT        NOT NULL  -- denormalized for RLS performance
);
