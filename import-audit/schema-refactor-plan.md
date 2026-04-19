# Schema Refactor: System Metadata → Columns

## Goal

Separate intrinsic entry properties (`title`, `type`, `mime_type`) from arbitrary user metadata. Promote the first group to typed columns; nest import-provenance under `_import` in the jsonb metadata.

## Target schema

```sql
CREATE TABLE entries (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    content     TEXT        NOT NULL,
    path        TEXT[]      NOT NULL DEFAULT '{}',
    title       TEXT        NOT NULL,                                -- NEW
    type        TEXT        NOT NULL,                                -- NEW
    mime_type   TEXT        NOT NULL DEFAULT 'text/markdown',        -- NEW
    metadata    JSONB       NOT NULL DEFAULT '{}',                   -- user metadata + _import
    agent_id    TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX entries_title_idx ON entries (title);
CREATE INDEX entries_type_idx ON entries (type);
CREATE INDEX entries_mime_idx ON entries (mime_type);
```

`metadata` after refactor contains:
- `_import` — provenance, only set during import: `{ source, original }`
- Everything else — user-defined, free-form

## Migration

```sql
-- 1. Add columns (nullable initially so we can backfill)
ALTER TABLE entries
    ADD COLUMN title     TEXT,
    ADD COLUMN type      TEXT,
    ADD COLUMN mime_type TEXT NOT NULL DEFAULT 'text/markdown';

-- 2. Backfill from existing metadata
UPDATE entries SET
    title = metadata->>'title',
    type  = metadata->>'type';

-- 3. Migrate provenance keys under _import
UPDATE entries SET metadata = metadata 
    || jsonb_build_object('_import',
         jsonb_strip_nulls(jsonb_build_object(
             'source',   metadata->>'source',
             'original', metadata->>'original-source'
         ))
       )
    WHERE metadata ? 'source' OR metadata ? 'original-source';

-- 4. Drop promoted/migrated keys from metadata
UPDATE entries SET metadata = metadata - 'title' - 'type' - 'source' - 'original-source';

-- 5. Enforce NOT NULL
ALTER TABLE entries
    ALTER COLUMN title SET NOT NULL,
    ALTER COLUMN type  SET NOT NULL;

-- 6. Indexes
CREATE INDEX entries_title_idx ON entries (title);
CREATE INDEX entries_type_idx  ON entries (type);
CREATE INDEX entries_mime_idx  ON entries (mime_type);
```

## Code changes

### `mcp/src/tools/insert.ts`

Current:
```ts
interface InsertInput {
  content: string;
  path?: string[];
  metadata?: Record<string, unknown>;
  ...
}
```

New:
```ts
interface InsertInput {
  content: string;
  path?: string[];
  title: string;           // required
  type: string;            // required
  mime_type?: string;      // defaults to 'text/markdown'
  metadata?: Record<string, unknown>;
  ...
}
```

The INSERT SQL moves title/type/mime_type into their own columns.

### `mcp/src/tools/update.ts`

Analogous changes. `title`, `type`, `mime_type` as optional top-level fields; metadata remains merge-replace of user data.

### `mcp/src/tools/search.ts` + `db/init/05-functions.sql` (`match_entries`)

Filter logic currently operates on `metadata` jsonb. Needs to filter on columns:
- `filter: { title: "Foo" }` → `WHERE title = 'Foo'`
- `filter: { type: "note" }` → `WHERE type = 'note'`
- `filter: { "some_custom_field": "x" }` → `WHERE metadata @> '{"some_custom_field":"x"}'`

Response shapes: include `title`, `type`, `mime_type` as top-level fields alongside `id`, `content`, `path`, `metadata`.

### `mcp/src/tools/delete.ts`

No changes — deletion by id.

### `mcp/src/tools/fetch.ts`

No changes — external HTTP fetch.

### `db/init/03-schema.sql.tpl`

Add the new columns so fresh installs get the schema.

## Script changes

### `import-audit/build-full-manifest.py`

Manifest entries currently:
```json
{ "title": "...", "path": [...], "content": "...", "metadata": { "type": "reference", "title": "...", "source": "obsidian", ... } }
```

New shape:
```json
{
  "title": "...",       // top-level
  "type": "reference",  // top-level
  "mime_type": "text/markdown",  // top-level (default)
  "path": [...],
  "content": "...",
  "metadata": {
    "_import": { "source": "obsidian", "original": "/Data/Films/..." },
    "tags": [...],
    ...user fields
  }
}
```

### `import-audit/bulk-import.py`

Pass title/type/mime_type as top-level args to the insert tool.

### `import-audit/sync-import.py`

Pass the new fields. Modify the insert/update calls accordingly.

### `import-audit/audit-import.py`

Update SQL queries: use column projections instead of metadata keys (`title, type, ...` instead of `metadata->>'title'`). Also update the `source=obsidian` filter to check `metadata->'_import'->>'source' = 'obsidian'`.

### `import-audit/pass2-resolve.py`

Update queries for loading entries + title lookup.

### `import-audit/tree.py`

Trivial — update the query to pull title from the column.

### `import-audit/sync-import.py` (reverse orphan check)

Also needs the `_import` path change for identifying obsidian entries.

## Execution order

**Phase A: Prepare**
1. Backup DB.
2. Write migration SQL as a file (`db/init/09-system-metadata.sql`) for future fresh installs.

**Phase B: Stop traffic**
3. Stop the mcp container (no writes). (librechat and other dependents will queue.)

**Phase C: Schema migration**
4. Run migration SQL on live DB.

**Phase D: Update code**
5. Update MCP server sources (insert, update, search, response shaping).
6. Update `match_entries` SQL function.
7. Rebuild + restart mcp: `docker compose up -d --build mcp`.
8. Verify health endpoint.

**Phase E: Update tooling**
9. Update build-full-manifest, bulk-import, sync-import, audit-import, pass2-resolve, tree.
10. Re-run `audit-import.py` to verify shape is consistent.

**Phase F: Verify**
11. Do a `sync-import.py --dry-run` — should show 0 diffs.
12. Spot-check a few entries via MCP search — verify title/type/mime_type come back in responses.
13. Make a fresh backup with the new shape.

## Risks / edge cases

- **Existing data without title/type**: shouldn't happen post-import, but the backfill would fail on NULL. Check first.
- **Orphan tag stubs** (path `/tags/<x>`) — do they have title/type? Yes, we set both at creation.
- **`match_entries` signature change** — callers need to pass new filter keys. We control all callers.
- **API consumers** (LibreChat) — any that rely on `metadata.title` won't break immediately because we return both column and metadata in responses. We can deprecate gradually.
- **RLS policies** — unaffected, still key on `agent_id`.

## Non-goals

- Changing `path` structure
- Moving tags to columns (stays in metadata / links graph)
- Changing chunks/embedding layout
- Changing response shape beyond adding new top-level fields

## Success criteria

- All entries have NOT NULL title + type
- No `title`, `type`, `source`, `original-source` at top level of metadata
- All tools (insert/update/search) work against new shape
- Audit passes (forward + reverse)
- Downstream services work (LibreChat still usable)
