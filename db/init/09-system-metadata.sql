-- Promote intrinsic metadata (title, type) to columns and add mime_type.
-- Move import provenance (source, original-source) into metadata._import nested object.
--
-- Idempotent for both scenarios:
--   Fresh installs — 03-schema.sql.tpl already creates the new columns, so the
--     IF NOT EXISTS on ALTER skips; UPDATEs are no-ops (no rows); indexes are
--     a no-op (IF NOT EXISTS via DO block).
--   Existing DBs   — adds columns, backfills, drops old keys, enforces NOT NULL.

-- 1. Add columns (no-op if already present)
ALTER TABLE entries
    ADD COLUMN IF NOT EXISTS title     TEXT,
    ADD COLUMN IF NOT EXISTS type      TEXT,
    ADD COLUMN IF NOT EXISTS mime_type TEXT NOT NULL DEFAULT 'text/markdown';

-- 2. Backfill from metadata (no-op on fresh install)
UPDATE entries SET
    title = metadata->>'title'
    WHERE title IS NULL AND metadata ? 'title';

UPDATE entries SET
    type  = metadata->>'type'
    WHERE type IS NULL AND metadata ? 'type';

-- 3. Nest import provenance under _import (no-op on fresh install)
UPDATE entries SET metadata = metadata
    || jsonb_build_object('_import',
         jsonb_strip_nulls(jsonb_build_object(
             'source',   metadata->>'source',
             'original', metadata->>'original-source'
         ))
       )
    WHERE metadata ? 'source' OR metadata ? 'original-source';

-- 4. Drop promoted/migrated keys from metadata
UPDATE entries SET metadata = metadata - 'title' - 'type' - 'source' - 'original-source'
    WHERE metadata ?| ARRAY['title','type','source','original-source'];

-- 5. Enforce NOT NULL on title/type (no-op if already NOT NULL)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='entries' AND column_name='title' AND is_nullable='YES') THEN
        ALTER TABLE entries ALTER COLUMN title SET NOT NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='entries' AND column_name='type' AND is_nullable='YES') THEN
        ALTER TABLE entries ALTER COLUMN type SET NOT NULL;
    END IF;
END $$;

-- 6. Indexes on the new columns
CREATE INDEX IF NOT EXISTS entries_title_idx ON entries (title);
CREATE INDEX IF NOT EXISTS entries_type_idx  ON entries (type);
CREATE INDEX IF NOT EXISTS entries_mime_idx  ON entries (mime_type);
