# Import Progress

## Pass 1: Scaffold & Index

- [x] **Step 1**: Roam stubs → /concepts/ (1,063 entries) — 2026-04-18
- [x] **Step 2**: Roam stubs → /data/people/ (103 entries) — 2026-04-18
- [x] **Step 3**: Roam substantive/light notes → various paths — 2026-04-18
- [x] **Steps 4–18**: All non-Roam vault content via full-manifest — 2026-04-19
  - Data/Films, Data/Books, Data/People, Data/Recipes, Data/Gear/Eurorack, Data/Relationships, Data/Software, Data/Habits, Data/Businesses, Data/Television, Data/Games, Data/Cleanup
  - Periodic Notes (Daily + Weekly)
  - Work/ (preserving subfolder structure)
  - Writing/Ziusudra/ (preserving subfolder structure), Writing/ loose files
  - Projects/
  - Studio/
- [x] **Step 19**: Roam special destinations (all routes) — 2026-04-18
- [x] **Timestamps fixed** for all imported entries (created_at/updated_at from frontmatter) — 2026-04-19
- [x] **Duplicates resolved** (175 rows removed) — 2026-04-19
- [x] **Forward+reverse audit run** — 66 missing (all intentional: Roam discards + System/ cherry-pick), 0 orphans, 1 minor metadata mismatch — 2026-04-19

## Pass 2: Link Resolution

- [x] **Step 20a**: Links table schema created (import version with `candidates` column) — 2026-04-19
- [x] **Step 20b**: Pass 2 scanner built (pass2-resolve.py) — 2026-04-19
- [x] **Step 20c**: Scanner run: 10,868 edges (8,471 wikilinks + 2,397 tags), 102 tag stubs auto-created — 2026-04-19
- [x] **Step 20d**: Ambiguities resolved (5 total: The Holy Mountain ×2, Enki ×3) — 2026-04-19
- [x] **Step 20e**: Dangling cleanup pass:
  - 1,250 Roam-duplicate-export refs deleted
  - 122 date stubs auto-created, 150 date refs resolved
  - 154 Acima stubs auto-created, 641 Acima refs resolved
- [ ] **Step 20f**: Remaining dangling links — **deferred** (see Follow-ups)
- [x] **Step 20g**: Wire link scanning into insert/update tools (live hooks) — 2026-04-19
- [x] **Step 20h**: Drop `candidates` column — 2026-04-19
- [x] **Daily note title normalization**: 577 frontmatter titles + 50 wikilinks → ISO format; sync-import extended with title/content diff detection — 2026-04-19

## Pass 3: Subagent Definitions

- [ ] **Step 21**: Port Obsidian skills + create new subagents

---

## Follow-ups (deferred work)

### Dangling wikilinks review (2,337 edges)

After the cleanup pass, 2,337 wikilinks remain dangling. Breakdown:

- **~1,516 Beelzebub's Tales internal vocabulary** — Gurdjieff book references terms like "three-brained beings", "Harnel-miatznel", "Holy-Affirming" that have no meaning outside the book. Low priority to stub. Accept as legacy.
- **~200 prose-format date references** — `April 4, 2020` style. Will resolve after we normalize daily note titles to include both formats or do a secondary resolution pass using a date-parser.
- **Abstract concepts** (`fruit`, `vanity`, `Spirit`, `Zen`, `future`) — one-off Roam-era stream-of-consciousness references. Not worth stubbing.
- **Legitimate books/media never imported** — e.g. `Turning Pro Tap Your Inner Power...`, `The Occult A History (1971)`. Could be auto-stubbed at `/data/books/` based on `(YYYY)` pattern, but deferred until we decide how much to auto-fill.
- **Project names** — a few real references like `Project Electronic Music Studio Setup`.

Action: leave dangling for now. Revisit when (a) daily note title normalization is done, (b) we wire in insert/update hooks (which will surface dangling via warnings on edit).

### Pass 2 Step 6: Insert/update link hooks

Need to modify `mcp/src/tools/insert.ts` and `update.ts` to:
- After entry write, scan content for wikilinks + tags
- Auto-create tag stubs on demand
- Replace old links for that source with fresh scan
- **Strict live mode**: throw on ambiguous or dangling wikilinks (import mode tolerated them)

See `pass-2-plan.md` Step 6 and the hook-design notes.

### Drop `candidates` column

Post-import cleanup. Wait until live hooks are in + confidence in graph.

### ~~Normalize daily note titles~~ — DONE 2026-04-19

Completed via `normalize-daily-titles.py` + `verify-normalization.py`. 577 prose-titled daily note frontmatter values + 50 prose-date wikilinks rewritten to ISO. As a side effect, 71 additional concept stubs were auto-created by the live-mode link hook during rescans (concept-graph philosophy working as designed).

### Minor cleanups

- One metadata mismatch: `/Roam/FLAC vs Lossy Audio Formats.md` has `tags:` as list in frontmatter; our parser didn't preserve it.
- A few tag stubs look dubious (`await`, `b475`, `matthew`, `what`, `via`) — could delete manually if we care.

### Productize the Obsidian importer

The tooling in `import-audit/` is a one-shot, highly opinionated to my specific vault structure:
- Hardcoded routing rules (Data/Films → /data/films/, Writing/Ziusudra → /writing/ziusudra/, etc.)
- Manual reclassifications for Roam exports (reclassifications.md)
- Vault-specific filename disambiguation (colons stripped, bracket handling)

Proper importer should:
- Accept a routing config (YAML/JSON) so users declare their own folder→path mapping
- Handle any Obsidian vault layout, not assume Roam-legacy-quirks
- Ship as either a Talos CLI subcommand (`./talos import <vault>`) or MCP skill
- Provide dry-run + diff preview
- Surface ambiguity/dangling link decisions through a structured queue, not ad-hoc SQL
- Use a persistent DB connection (psycopg2) — not per-query subprocess

The current `sync-import.py` is close to reusable once it's decoupled from our specific manifest builder. The `build-full-manifest.py` is where the opinionated logic lives.
