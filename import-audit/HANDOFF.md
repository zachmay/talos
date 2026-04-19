# Obsidian → Talos Import Handoff

**As of 2026-04-19.** This document summarizes the current state of the Talos DB, how to operate it, what's left to do, and future ideas that came out of the session.

See also: [progress.md](progress.md), [pass-2-plan.md](pass-2-plan.md), [graph-db-design.md](graph-db-design.md), [schema-refactor-plan.md](schema-refactor-plan.md).

## Current state

**Schema:**

```sql
entries (
  id uuid, content text, path text[],
  title text NOT NULL,              -- system column
  type text NOT NULL,               -- system column
  mime_type text NOT NULL DEFAULT 'text/markdown',
  metadata jsonb,                   -- user fields + _import provenance
  agent_id text, created_at, updated_at
)

chunks (id, entry_id FK CASCADE, chunk_idx, chunk_text, embedding vector(1536), agent_id)

links (
  id uuid, agent_id text,
  source_id FK CASCADE, target_id FK SET NULL,
  link_text text, link_type link_type ENUM ('wikilink','tag','embed','mention'),
  UNIQUE(source_id, link_type, link_text)
)
```

Provenance nested: `metadata._import = { source: 'obsidian'|'auto-created', original: '/Data/...' }`

**DB populated:**

| Metric | Count |
|---|---|
| Entries (total) | ~4,997 |
| Entries from Obsidian (`_import.source='obsidian'`) | ~4,533 |
| Auto-created stubs (`_import.source='auto-created'`) | ~440 (tags + concepts + dates + work refs) |
| Links (edges) | ~9,621 |
| Chunks (embedded) | ~3,195 |

**MCP server** (`mcp/src/`):

- `insert.ts`, `update.ts`, `search.ts` — tools take `title`, `type`, `mime_type` as top-level params; metadata column is user-facing
- `links.ts` — shared `scanAndStoreLinks` used by insert/update hooks; resolves wikilinks/tags, auto-stubs dangling wikilinks at `/concepts/<name>`, auto-creates tag stubs at `/tags/<name>`, rejects ambiguous wikilinks with `AMBIGUOUS_LINK` error
- `chunker.ts` — handles empty content (stubs get no chunks)
- `transport.ts` — 10MB body limit (large entries like full books work)
- `match_entries` SQL function filters by column (title/type/mime_type) or metadata containment

**Import tooling** (`import-audit/`):

- `build-full-manifest.py` — scans the Obsidian vault, routes files to DB paths, outputs `full-manifest.json`
- `bulk-import.py` — batch-inserts manifest via MCP HTTP, checkpoints GUID index, resumable
- `sync-import.py` — idempotent sync; detects changes via title/content diff (not just mtime); supports `--dry-run`, `--yes`, `--delete-orphans`
- `audit-import.py` — bidirectional audit (vault↔DB), writes report
- `pass2-resolve.py` — one-shot bulk link scanner (permissive mode)
- `tree.py` — DB structure explorer
- `normalize-daily-titles.py` / `verify-normalization.py` — one-shot title normalization (done)

**Commits landed on `main`:**

```
dd1104c docs(import): update progress tracker after normalization
ed2aaf0 feat(import): daily-note title normalization with verify tooling
ffcc6bd refactor(links): drop import-only candidates column
92a2a63 feat(mcp): live link hooks with concept and tag auto-stubbing
64232aa chore: remove stale example-skill placeholder
9036630 feat(import): add Obsidian vault import tooling and Pass 2 link resolution
56e8c3c feat(db): promote title/type/mime_type to columns, add links graph table
```

**Backups (gitignored):**

- `backups/talos_20260419_015249.dump` — post-schema-refactor, pre-hook snapshot
- `backups/talos_20260419_013813.dump` — pre-refactor fallback

## Operating instructions

### Sync new changes from Obsidian

Run periodically as you continue writing in the vault:

```bash
# Preview
python3 import-audit/sync-import.py --dry-run

# Apply (prompts for confirmation)
python3 import-audit/sync-import.py

# Apply without prompt (for scripting)
python3 import-audit/sync-import.py --yes

# Also delete DB entries for files removed from vault
python3 import-audit/sync-import.py --delete-orphans
```

Detects: new files, changed files (title/content/updated diff), orphan entries whose source file is gone.

Skips: `/Roam/` paths (frozen archive), `.obsidian/`, `.trash/`, `.claude/`, `.git/`, `node_modules/`, `CLAUDE.md`, `AGENTS.md`, `Video Games/` (empty), `Music/` (empty), `social-chatter-2026-02-06-15-52-55/` (duplicate).

### Verify health

```bash
python3 import-audit/audit-import.py          # forward + reverse audit
python3 import-audit/audit-import.py --reverse-only   # DB→vault only
python3 import-audit/tree.py                  # DB path tree with counts
python3 import-audit/tree.py --titles --max-titles=99999 > tree.txt
```

### Backup

```bash
./talos backup --db-only
```

### Schema changes

No migration framework yet. For fresh installs, `db/init/*.sql` applies in order. For existing DBs, you apply migrations by hand:

```bash
docker compose exec -T db psql -U postgres -d talos < db/init/<new-file>.sql
```

If it references `match_entries` or grants, also regrant: see `db/init/06-rls.sql`.

### MCP server rebuild after code changes

```bash
docker compose up -d --build mcp
```

A plain `restart mcp` won't pick up source changes — the image must be rebuilt.

## What's left before "done done" on Obsidian import

Minimum bar per discussion:

1. **Sync change detection for frontmatter-only edits** — currently compares title + content. Should add full metadata comparison so a `status: planning → in-progress` change without touching `updated` gets picked up.
2. **`./talos sync` CLI wrapper** — convenience over `python3 import-audit/sync-import.py`. Probably a line in `scripts/`.
3. **Document workflow in CLAUDE.md** — "how to sync Obsidian changes" — so it's rediscoverable.
4. **Decide rename handling** — currently orphan+new pair loses UUIDs. Options: accept (no renames), detect via title/content similarity, or write UUIDs to frontmatter.

Optional polish:
- FLAC YAML tags-list parser bug (one entry)
- ~5 dubious tag stubs (await, matthew, what, via, b475)
- 2,223 remaining dangling wikilinks (mostly Beelzebub book internal vocab + abstract concepts)

## What's left on the Talos roadmap (beyond import)

**Pass 3 — Subagent Definitions** (biggest unfinished phase of the original plan):

Port the 11 Obsidian skills to Talos subagents, create 6 new librarians (film, book, people, media, ziusudra-literary-assistant, concept-miner). Stored at `/system/agents/<name>`. Scoped to subtrees with their own metadata conventions. Details in [../import-plan.md](../import-plan.md).

**Migration framework:**

We've hit manual-apply pain on two schema changes now (adding links table, promoting title/type). A `schema_migrations` tracking table + a startup hook that applies pending `db/migrations/NNN-*.sql` files would prevent this. Small win but noticeably affects ops every time.

**Obsidian importer productization:**

The scripts in `import-audit/` are vault-specific (Roam reclassifications, hardcoded routing). A generalized Talos import skill would accept a YAML config declaring folder→path mapping, handle any layout, use a persistent DB connection (psycopg2) instead of per-query subprocess.

## Future ideas (from this session)

### VS Code extension: Talos Viewer + Tree Explorer

Discussed but not built. Architecture:

- **Sidebar tree view** (`TreeDataProvider`) mirrors the DB path hierarchy; expand folders, click entries
- **Webview panel** renders entry markdown with interactive elements:
  - `[[wikilinks]]` become clickable, using the `links` table to resolve to target UUIDs
  - `#tags` link to a tag-filtered list
  - `- [ ]` / `- [x]` checkboxes clickable → round-trip through MCP update → re-embed + rescan
- **URI handler** `vscode://talos.viewer/entry/<uuid>` — lets Claude open entries in the panel via markdown links in chat
- **Multiple views in sidebar**: Entries, Tags, Recent, Backlinks (reactive to current entry)

MCP-side additions this would need:
- `get(id)` — single-entry fetch (currently awkward via search)
- `list_children(path)` — for tree view; one SQL query on path prefix
- `backlinks(id)` — entries linking to a target

Effort estimate: viewer MVP ~1 day, tree view ~1 day, full polish (context menus, quick-pick filter, drag-to-reparent, SSE for live refresh) another ~1 day.

Benefits over a browser-tab viewer:
- Side-by-side with Claude's chat in same window
- Native theme, keybindings, typography
- No separate server process to manage
- URI routing works from anywhere (other chats, docs, clipboard)

### UUID-markdown link migration (deferred Pass 2.5)

Current content preserves `[[wikilinks]]` as text. Long-term, rewriting to `[text](uuid)` style makes ambiguity impossible by construction and stabilizes against title changes. Trade-offs:

- **Pro:** no ambiguity; rename-resilient (UUID never changes); standard markdown
- **Con:** UUIDs in content add embedding noise (mitigate by stripping before embedding); rename cascades to all source entries referencing the renamed target (re-embed cost); authoring needs UI picker

Approach: a one-shot migration that scans every entry, resolves each wikilink via the `links` table, rewrites content, re-embeds. Live-mode tools transition to accepting UUID-markdown format. The `links` table stays as the graph-truth store; content becomes self-referential.

Full design notes in [graph-db-design.md](graph-db-design.md).

### Checkbox on-disk write-back to Obsidian

If the viewer's checkbox toggle should also update the source `.md` file in the Obsidian vault (keeping vault and DB in sync in both directions), need a reverse-sync: when an entry's content changes in DB, write the change back to `<vault>/<original-source>`. Currently the flow is one-way (vault → DB via sync-import).

### Search quality validation

We haven't stress-tested semantic search quality across the full corpus. A set of canned queries with known-good results would help validate pgvector is returning relevant hits.

## Known limitations

- **Rename detection** — missing; renames look like orphan+new, losing UUID
- **Retroactive dangling resolution** — when a new entry is created, dangling links with matching `link_text` don't auto-resolve; only rescanning the source entries does it
- **Tag stub orphan cleanup** — tag stubs that become unreferenced stay around
- **Roam-block-ref wikilinks** (`[[.../2021-01-25#^blockid]]`) — auto-stub into `/Roam/...` junk on rescan; manually cleaned, but the scanner could filter these
- **Single-agent** — no multi-user flows exercised yet; schema supports it (`agent_id` columns + RLS)

## Recovery / rollback

If anything goes badly wrong:

```bash
./scripts/restore.sh backups/talos_20260419_015249.dump  # post-refactor state
./scripts/restore.sh backups/talos_20260419_013813.dump  # pre-refactor state
```

Then rebuild MCP to match whichever code state corresponds: `docker compose up -d --build mcp`.

For wiping links only (safe, doesn't touch entries):

```sql
TRUNCATE links;
```

Then re-run `pass2-resolve.py` to repopulate.
