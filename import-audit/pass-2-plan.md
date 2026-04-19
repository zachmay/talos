# Pass 2: Link Resolution — Plan

## Goal

Build a `links` table that models the knowledge graph as typed, directional edges between entries. Populate it by scanning the content of every imported entry for wikilinks and tags, resolving each to a target entry UUID. After import, ambiguity-related fields are dropped from the schema.

## Motivation

- Enable graph queries: backlinks, neighborhoods, tag filtering, path-finding
- Preserve Obsidian's link semantics (text stays human-readable) while making edges first-class and indexed
- Match Roam's "concept graph" philosophy: tags and wikilinks both become graph nodes
- Prepare for eventual migration to UUID-based markdown links (`[text](uuid)`), where link resolution at content rewrite time is already validated

## Design decisions (already made)

| Decision | Choice | Rationale |
|---|---|---|
| Content rewriting | Leave content untouched for now | Preserves embedding quality; links table is derived |
| Link representation | Sidecar `links` table; entries unchanged | Backlinks in O(log n) instead of O(n) content scans |
| Tag representation | Tags are first-class entries at `/tags/<name>`, auto-created as stubs | Unified graph; tags and wikilinks queried the same way |
| Ambiguity | Import-only concern; `candidates` column dropped after manual resolution | Live system authors UUID links directly; ambiguity impossible |
| Dangling wikilinks | Flag only during import (no auto-stub) | User decides case-by-case whether to stub or fix |
| Status column | Not needed; derivable from `target_id` / `candidates` | Avoids consistency drift |
| `metadata.tags` duplication | Still populated alongside graph edges | Cheap; enables single-row "tags on this entry" reads |

## Schema — import version

```sql
CREATE TYPE link_type AS ENUM ('wikilink', 'tag', 'embed', 'mention');

CREATE TABLE links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id text NOT NULL,
  source_id uuid NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  target_id uuid REFERENCES entries(id) ON DELETE SET NULL,
  link_text text NOT NULL,
  link_type link_type NOT NULL,
  candidates uuid[],                    -- IMPORT-ONLY column
  created_at timestamptz NOT NULL DEFAULT now(),

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
```

## Schema — post-import version (after ambiguities resolved)

```sql
ALTER TABLE links DROP COLUMN candidates;
ALTER TABLE links DROP CONSTRAINT links_resolved_no_candidates;
ALTER TABLE links DROP CONSTRAINT links_ambiguous_has_candidates;
```

Remaining meaning of `target_id`:
- `NOT NULL` → resolved edge
- `NULL` → dangling (target was deleted post-creation; a runtime anomaly)

## Scanning rules

Applied to every entry's `content` field.

### Wikilinks

Regex: `\[\[([^\]]+)\]\]`

For each match:
1. Extract the raw bracket text (e.g., `Aristotle`, `data/foo`, `foo|Bar`)
2. If alias syntax `foo|Bar`, keep only `foo` as link text for resolution; `Bar` is display-only (not stored)
3. Resolve against title→GUID index:
   - **Path-qualified** (`data/foo`): match entry where `path == ['data'] && title == 'foo'` (or full path prefix)
   - **Unqualified** (`foo`): match entries where `title == 'foo'`
4. Produce one row:
   - 1 match → `target_id=uuid, candidates=NULL`
   - 2+ matches → `target_id=NULL, candidates=[uuid1, uuid2, ...]`
   - 0 matches → `target_id=NULL, candidates=NULL` (dangling)

### Tags

Regex: `(?:^|\s)#([a-zA-Z0-9][\w/-]*)` for bare tags, `#\[\[([^\]]+)\]\]` for bracketed tags

For each match:
1. Extract tag name (e.g., `protagonist`, `Quick Capture`)
2. Normalize:
   - `Roam-Highlights` → `roam-highlight`
   - `Quick Capture` → `quick-capture`
   - Otherwise lowercase, hyphenate spaces
3. Ensure stub entry exists at `/tags/<normalized-name>`:
   - If not, insert `{content: '', path: ['tags', name], metadata: {type: 'tag', title: name, source: 'auto-created'}}`
4. Add row: `target_id=<tag-stub-uuid>, link_type='tag', link_text=<original-tag-name>`
5. Also mirror to `entries.metadata.tags` on the source entry (array, deduplicated)

### Embeds

Out of scope for Pass 2. Regex `!\[\[([^\]]+)\]\]` matches can be added later.

### Mentions

Out of scope for Pass 2.

## Step-by-step execution

### Step 1 — Write migration and schema
- Add `mcp/migrations/002_links_table.sql` (or equivalent)
- Apply to live DB
- Verify RLS + indexes

### Step 2 — Build Pass 2 scanner
- Python script `import-audit/pass2-resolve.py`
- Reads all entries with non-empty content
- Builds in-memory title→GUID index (grouped by path for path-qualified lookups)
- For each entry: scan content, resolve links, prepare insert batch
- Creates tag stubs on-demand (tracked in a local cache to avoid re-creating)
- Batch-inserts rows into `links`
- Writes audit artifacts:
  - `pass2-report.md` — totals: resolved / ambiguous / dangling counts, per-type breakdown
  - `ambiguous-links.md` — list of (source entry path, link_text, candidates) for manual review
  - `dangling-links.md` — list of (source entry path, link_text, link_type) for manual review
  - Summary of auto-created tag stubs

### Step 3 — Disambiguation
Two resolution options:
- **Rewrite content**: edit `entries.content` to use path-qualified wikilinks like `[[data/foo]]`, then rescan that entry
- **Direct row update**: `UPDATE links SET target_id = $1, candidates = NULL WHERE id = $2` for picked candidate
- Provide helper script `import-audit/disambiguate.py` that walks ambiguous rows interactively

Stop condition: `SELECT count(*) FROM links WHERE candidates IS NOT NULL = 0`

### Step 4 — Dangling resolution
For each dangling link, three options:
- Fix source content (typo correction)
- Auto-stub the target at `/concepts/<name>` and rerun scan for that entry
- Leave dangling (accept as legacy artifact — rare but possible)

Decide policy per entry during manual review; no automated default.

### Step 5 — Drop import columns
Once all ambiguities resolved:
```sql
ALTER TABLE links DROP COLUMN candidates;
```

### Step 6 — Wire into insert/update tools
Modify `mcp/src/tools/insert.ts` and `update.ts`:
- After successful entry insert/update, run link scanner on the new content
- Delete old links for that `source_id` and replace with fresh scan
- Auto-create missing tag stubs during scan
- Raise `DANGLING_LINK` error if any wikilinks fail to resolve (in live mode, unlike import mode which tolerates dangling)

This ensures the graph stays consistent as entries evolve going forward.

## Audit outputs

Pass 2 produces:

| Artifact | Purpose |
|---|---|
| `pass2-report.md` | Summary counts for confidence |
| `ambiguous-links.md` | Manual resolution queue |
| `dangling-links.md` | Manual resolution queue (or accept) |
| `tag-stubs-created.txt` | New `/tags/<name>` entries auto-created |
| DB table `links` | The graph itself |

## Risks / edge cases

- **Performance**: scanning ~3k entries with content, each producing ~5-30 links, means ~50k rows inserted. Batch with COPY or multi-value INSERT to avoid per-row latency.
- **Tag normalization drift**: if a tag name differs by a subtle character (`Café` vs `café`), we might create two stubs. Normalize aggressively; document the rules.
- **Very long daily notes**: some entries have 100+ wikilinks. UNIQUE constraint on `(source_id, link_type, link_text)` means we collapse duplicate references within one note — intended, but worth verifying.
- **Titles with brackets in them**: e.g., `Recipe: Chana Masala` might appear as `[[Recipe: Chana Masala]]`. Resolution by exact title-match handles this fine.
- **Case sensitivity**: titles are compared exactly as stored. If users expect case-insensitive matching, add it to the scanner.

## Success criteria

- `links` table populated with ≥N edges (estimate later during scan)
- 0 rows remain with `candidates IS NOT NULL` at end of Phase B
- Dangling links reviewed; each has an explicit disposition (fix, stub, or accept)
- Insert/update hooks keep graph consistent for future entries
- `candidates` column dropped from schema

## Out of scope (deferred)

- Embed links (`![[foo]]`)
- Mention links
- Block-level references
- UUID-markdown-link content rewrite (separate later migration)
- Rename cascade (update source content when target renames) — left as manual for now
- Retroactive dangling retry (rescan existing dangling links when new entries are created) — handled via periodic full scan, not real-time
