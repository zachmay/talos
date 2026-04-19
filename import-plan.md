# Obsidian Vault Import Plan

Source: `~/Documents/Exocortex/` (~4,621 markdown files)
**Read-only constraint**: Do not modify any files in the source vault.

## Constraints and Context

- The Obsidian vault is read-only. All operations are inserts into the Talos database via MCP tools.
- The `Roam/social-chatter/` subdirectory contains the bulk of Roam content (1,312 of 1,320 files). The remaining 7 are loose files directly under `Roam/`.
- `Roam/social-chatter-2026-02-06-15-52-55/` is a duplicate export — skip entirely.
- Filenames with colons (e.g. `Recipe: Red Lentil Curry.md`) need shell quoting when reading.
- Detailed per-entry audit lists are in `import-audit/` alongside this file:
  - `roam_stubs.txt` — all 1,147 stub titles
  - `roam_audit_people.txt` — 103 entries with `[person]`/`[artist]`/`[band]` prefixes
  - `roam_audit_music.txt` — 66 entries with `[release]`/`[gear]` prefixes
  - `roam_audit_media.txt` — 221 entries with `[book]`/`[film]`/`[tv]`/`[game]`/`[media]` prefixes
  - `roam_audit_esoterica.txt` — 158 entries
  - `roam_audit_concepts.txt` — 407 entries
  - `roam_audit_personal.txt` — 167 entries
  - `roam_audit_junk.txt` — 26 entries (original; see reclassifications.md for final dispositions)
  - `reclassifications.md` — every decision that overrides the original audit classification

## MCP Tools Reference

All database operations use these tools:

| Tool | Purpose | Key Parameters |
|---|---|---|
| `mcp__talos__insert` | Create a new entry | `content` (string, **min 1 char**, max 50000), `path` (string array), `metadata` (JSONB), `chunk_size`, `chunk_overlap`, `verbose` |
| `mcp__talos__search` | Semantic search / path listing | `query` (text), `path` (prefix filter, string array), `threshold` (0-1, default 0.7), `count` (max results), `filter` (JSONB metadata filter), `depth`, `verbose` |
| `mcp__talos__update` | Update entry content and/or metadata | `id` (UUID, **required**), `content` (optional, min 1 char), `metadata` (optional JSONB, merged), `chunk_size`, `chunk_overlap`, `verbose` |
| `mcp__talos__delete` | Delete entry and its chunks | `id` (UUID, **required**) |
| `mcp__talos__fetch` | Fetch content from a URL | `url` (required), `method` (GET/POST), `headers`, `body` — **NOT a database read**; use `search` to retrieve entries |

**Important**: There is no "get by ID" tool. To retrieve a specific entry, use `mcp__talos__search` with a path prefix and/or metadata filter. The `insert` tool returns the new entry's ID when `verbose: true` — capture this for the title→GUID index.

To build the title→GUID index during Pass 1, always call insert with `verbose: true` and record the returned ID.

### Stub handling

The `content` field has a minimum length of 1 character — truly empty strings are rejected. For stub entries (concept nodes with no content), use a single space `" "` or a minimal placeholder like the title itself. Recommend using the title as content for stubs so they are semantically searchable:

```
mcp__talos__insert({
  content: "political philosophy",
  path: ["concepts"],
  metadata: {
    type: "concept",
    title: "political philosophy",
    source: "obsidian",
    created: "2020-03-17T10:16:19",
    updated: "2020-03-17T10:16:19"
  }
})
```

### Example: Insert a content entry

```
mcp__talos__insert({
  content: "A reference note for the Self-Hosted Music Library project...",
  path: ["concepts"],
  metadata: {
    type: "reference",
    title: "FLAC vs Lossy Audio Formats",
    source: "obsidian",
    tags: ["audio", "music", "reference", "self-hosting"],
    created: "2026-03-25",
    updated: "2026-03-25"
  }
})
```

### Example: Insert a person

```
mcp__talos__insert({
  content: "Aristotle",
  path: ["data", "people"],
  metadata: {
    type: "reference",
    title: "Aristotle",
    subtype: "person",
    source: "obsidian",
    created: "2020-03-17T10:16:19",
    updated: "2020-03-17T10:16:19"
  }
})
```

## Execution Order

1. **Roam stubs → /concepts/** (~1,650 entries) — largest batch, mostly stubs, fast inserts. Establishes the concept graph backbone.
2. **Roam stubs → /data/people/** (103 entries) — small, clean batch.
3. **Roam substantive/light notes** → various paths (~115 entries with content, per reclassifications.md)
4. **Data/Films/** (726) → `/data/films/` — largest Data subfolder
5. **Data/People/** (288) → `/data/people/` — deduplicate against Roam people already inserted
6. **Data/Books/** (261) → `/data/books/`
7. **Data/Cleanup/** (98) → `/concepts/` — deduplicate against Roam concepts
8. **Data/Gear/Eurorack/** (64) → `/data/gear/eurorack/`
9. **Data/Relationships/** (53) → `/data/relationships/`
10. **Data/Recipes/** (16) → `/data/recipes/`
11. **Data/ small folders** (Software 6, Habits 5, Businesses 3, Television 1, Games 1) → respective paths
12. **Periodic Notes/Daily/** (1,456) → `/periodic-notes/daily/` — largest single batch, uniform structure
13. **Periodic Notes/Weekly/** (4) → `/periodic-notes/weekly/`
14. **Work/** (164) → `/work/` preserving subfolder structure
15. **Writing/Ziusudra/** (81) → `/writing/ziusudra/` preserving subfolder structure
16. **Writing/ loose files** (23) → `/writing/unfiled/`
17. **Projects/** (134) → `/projects/` preserving subfolder structure
18. **Studio/** (1) → `/studio/productions/`
19. **Roam special destinations**: recipes (4), relationships (1), ultan (17), studio (5), projects (22), adulting (90), lzc (3), work/unfiled (48)
20. **Pass 2: Link Resolution** — after all inserts complete
21. **Pass 3: Subagent Definitions** — after link resolution

## Totals Reconciliation

| Destination | Roam | Data/ | Writing/ | Projects/ | Work/ | Periodic | Studio/ | Total |
|---|---|---|---|---|---|---|---|---|
| /concepts/ | ~1,650 | 98 | — | — | — | — | — | ~1,748 |
| /data/films/ | — | 726 | — | — | — | — | — | 726 |
| /data/people/ | 103 | 288 | — | — | — | — | — | 391 |
| /data/books/ | — | 261+1 | — | — | — | — | — | 262 |
| /data/gear/eurorack/ | — | 64 | — | — | — | — | — | 64 |
| /data/relationships/ | 1 | 53 | — | — | — | — | — | 54 |
| /data/recipes/ | 4 | 16 | — | — | — | — | — | 20 |
| /data/software/ | — | 6 | — | — | — | — | — | 6 |
| /data/habits/ | — | 5 | — | — | — | — | — | 5 |
| /data/businesses/ | — | 3 | — | — | — | — | — | 3 |
| /data/television/ | — | 1 | — | — | — | — | — | 1 |
| /data/games/ | — | 1 | — | — | — | — | — | 1 |
| /writing/ziusudra/ | — | — | 81 | — | — | — | — | 81 |
| /writing/unfiled/ | — | — | 23 | — | — | — | — | 23 |
| /writing/ultan/ | 17 | — | — | — | — | — | — | 17 |
| /projects/ | 22 | — | — | 134 | — | — | — | 156 |
| /projects/mushroom-cultivation/ | 10 | — | — | — | — | — | — | 10 |
| /projects/adulting/ | ~90 | — | — | — | — | — | — | ~90 |
| /projects/lzc/ | 3 | — | — | — | — | — | — | 3 |
| /work/ | — | — | — | — | 164 | — | — | 164 |
| /work/unfiled/ | 48 | — | — | — | — | — | — | 48 |
| /periodic-notes/daily/ | — | — | — | — | — | 1,456 | — | 1,456 |
| /periodic-notes/weekly/ | — | — | — | — | — | 4 | — | 4 |
| /studio/ | 5 | — | — | — | — | — | 1 | 6 |
| Discard | 30 | — | — | — | — | — | — | 30 |
| **Subtotals** | **~1,983** | **1,522** | **105** | **134** | **164** | **1,460** | **1** | — |
| **Roam source** | 1,320 Roam files → 1,983 destinations (stubs counted once each; some reclassified across categories) | | | | | | | |
| **Grand total imported** | | | | | | | | **~5,339** |
| **Grand total discarded** | | | | | | | | **~30** |

Note: Roam "subtotal" exceeds 1,320 because the concepts bucket (~1,650) includes entries reclassified from multiple audit lists (media 221, music 66, esoterica 157, etc.) that were originally separate counts but all route to /concepts/.

---

## Architecture

### Two-Pass Import

**Pass 1 — Scaffold & Index**
Insert all entries (including stubs) with content, frontmatter metadata, and path. Build a `title → GUID` map.

**Pass 2 — Link Resolution**
For every entry:
1. Extract all `[[wikilinks]]` → resolve to GUIDs via the title index
2. Extract all `#tags` → store as `metadata.tags`
3. Update `metadata.links` with resolved GUID references
4. Clean up inline `[[bracket]]` syntax in ~30 concept titles

### Link Format

- Links stored as GUIDs internally for stability (titles change, GUIDs don't)
- `metadata.links` stores resolved mappings: `[{"guid": "abc123", "title": "Foo"}, ...]`
- Presentation layer resolves GUIDs back to readable titles at display time

### Concept Graph Philosophy

Empty "stub" entries are preserved as concept nodes. In the original Roam graph, typing `[[political philosophy]]` reified the concept — clicking the empty page showed all backlinks. This implicit concept graph is preserved by:
- Importing stubs as minimal entries (title + type + path, no content)
- Resolving all wikilink references to GUIDs during Pass 2
- Searching by concept returns all entries that link to it

### Metadata Extraction

From YAML frontmatter:
- `title` → `metadata.title`
- `created` → `metadata.created`
- `updated` → `metadata.updated`
- Other frontmatter fields preserved in metadata

From content:
- `[[wikilinks]]` → `metadata.links` (resolved to GUIDs in Pass 2)
- `#tags` and `#[[tags]]` → `metadata.tags`
- `#[[Roam-Highlights]]` and `#[[Quick Capture]]` → converted to metadata tags, stubs discarded

---

## Pass 1: Roam/ (1,320 entries)

### /concepts/ (~1,650 entries)

All stubs and lightly-categorized content that will be reorganized later as domain-specific ontologies (music, media, games, gear, etc.) are established.

Includes:
- Abstract concepts, academic/technical terms, programming concepts, music theory
- Esoterica, spirituality, philosophy, mysticism (157 entries)
- Media stubs — books, films, TV, games (221 entries)
- Music releases and gear (66 entries)
- General concept stubs from Roam (~407 entries)
- Plus reclassified entries:
  - `-punk`, `Pending Forward References`, `specialized` (from junk)
  - `hors d'oeuvre` (from personal)
  - `Kink` (from substantive notes)
  - `compute environment` (from substantive notes)
  - `Shalamar, the Cat Wizard` (from light notes)
  - All 7 top-level Roam files (incl. FLAC vs Lossy Audio Formats)

**Title cleanup needed:** ~30 entries have inline `[[bracket]]` syntax in titles (e.g. `[[anarchy]] vs [[control]]`) — strip brackets during import.

### /data/people/ (103 entries)

Named individuals classified as:
- `[person]` — authors, philosophers, historical figures, contacts (72)
- `[artist]` — solo musicians (17)
- `[band]` — musical groups (14), including `GrndNtl Brands` (reclassified from concepts)

Store classification in `metadata.subtype`.

### /data/relationships/ (1 entry)

- Roni

### /data/recipes/ (4 entries)

- Recipe: Red Lentil Curry
- Recipe: Red Beans and Rice
- Recipe: Chana Masala
- Recipe: Pumpkin Pie

Note: `Recipe: Stuffed Pepper Soup` already exists in vault Data/Recipes — skip (duplicate).

### /writing/ultan/ (~17 entries)

Ultan novel worldbuilding content:
- Channeling Sessions: Ultan Characters (502 lines)
- U:Theia, U:Harharkh, U:Karnak, U:Night, U:Ultan, U:Foillan
- Beelzebub notes, Djinn, The Trick
- New Sun Units of Measure
- Ultan Sequel Ideas
- Looisos, Theomertmalogos, Ashhark
- Trogoautoegocrat (painting)
- Parable of the Choir

### /studio/ (5 entries)

- Live Setup
- song-titles
- List: Band Names
- Recent New Music
- Music Production Project Priorities

### /projects/ (~22 entries)

Standalone projects:
- Project: Mushroom Cultivation
- Project: Oyakata - Sumo Simulator
- Project: Parallax - Roguelite Vertical Shooter
- Project: Western Trails
- Project: The Plague Album
- Project: Shit Sell-off
- Project: Enter Wonderland (DIY a Frequency Central Wonderland)
- Project: Backyard Soaking Tub
- Project: Better Computing Experience
- Project: Clean up Electronicsmithing Space
- Project: Divorce and House Refinance
- Project: Home Theater PC Build
- Project: Living Area Re-Paint
- Project: Morning Glory Cultivation
- Project: Personal Finance
- Project: Sitting Tub
- Project: Solar Roof
- Project: Solresol Esolang
- Project: Synology NAS
- Project: VPN Switch
- Project: VQGAN Tarot
- Project: Write an
- MtG Cube

### /projects/mushroom-cultivation/ (10 entries)

Supplies and reference for the cultivation project:
- brown rice flour
- fungus
- Psilocybe Cubensis
- Psylocybe Fanaticus
- spore syringe
- spores
- Sprouts
- sterility
- sterilization
- vermiculite

### /projects/adulting/ (~90 entries)

Finance, health, domestic, personal routine items. Includes:
- Credit cards: American Express, Ashley Furniture, Barclay's, Chase Amazon, Citi
- Bills, Monthly Bills, Mortgage, Taxes, Personal Budget, retirement
- Health: Chiropractor, Therapist, Trintellix, Physical Therapy Exercises, Sleep Log, etc.
- Domestic: Laundry, House tasks, Home Warranty, Honey-Dos, etc.
- Exercise: Neck and Shoulders, qi gong, Walk, yoga
- Trips, shopping lists, gift lists
- Adulting Plan, Domestic Priorities, Goals
- And ~30 more miscellaneous personal items

### /projects/lzc/ (3 entries)

Lexington Zen Center:
- LZC (reclassified from junk)
- Lexington Zen Center: Abbot Notes (from esoterica)
- Lexington Zen Center (from light notes)

### /work/unfiled/ (~48 entries)

Work tickets, pitches, and projects:
- Tickets: CA-2111, CA-2734, LZC-1470, Ticket 5940, etc.
- Pitches: AWS Reserved Instancing, Competencies, Email Infrastructure, Finance System Integration, Monitoring, Permissions Model/UX, PJC Transaction Management, SCORM Cloud Integration, System-Generated Front Matter
- Projects: AWS Reserved Instancing, JA-PARS Report, Job Hunt, LZC Food Service, New Job Transition, New Platform Finance Module, Obsidian Transition, Project Management
- Misc: certificate service integration testing POC, Legacy Site upgrade, Helm Migration, PHP 8 Migration, Scrum Notes, Sprint Planning, PRs, Pull Requests, etc.

### Discard (24 entries)

**Junk (17):**
4535, 4581, 697065, B475, delegated, film., forward-ref, Next, Not the same as, now known as, previously known as, some-day, unlisted, Untitled, uplift., version_4, º:**

**Roam meta (6):**
Personal Roam Theme, Roam Features, Roam Hacks, Roam Theme: Split Screen, Roam Theme: Roamness, Templates

**Duplicate (1):**
Recipe: Stuffed Pepper Soup (exists in Data/Recipes)

### Fix source docs + discard (2 entries)

- `peronsal` — typo, fix in referring document(s)
- `year)` — broken syntax, fix in referring document(s)

### Convert to metadata tags + discard (2 entries)

- `Roam-Highlights` — used as `#[[Roam-Highlights]]` in 6 files → extract as `metadata.tags: ["roam-highlight"]`
- `Quick Capture` — used as `#[[Quick Capture]]` in 25 files → extract as `metadata.tags: ["quick-capture"]`

### Subsumed by metadata + discard (2 entries)

- `watched` — becomes a metadata field on media entries
- `queued` — becomes a metadata field on media entries

---

## Pass 1: Data/ (1,522 files)

Each subfolder is a separate ontology managed by a scoped agent skill. Frontmatter pattern is consistent: `title`, `created`, `updated` in YAML. Content uses `[[wikilinks]]` and `#tags`. Many entries are sparse (title + author/director + read/watched status).

### /data/films/ (726 files)

Source: `Data/Films/`
Frontmatter: `title`, `created`, `updated`. Content has watch status (`[x] Watch`), `#film` tag, `#director` links.
Managed by: **film-librarian** skill (to be created).

### /data/people/ (288 files)

Source: `Data/People/`
Public figures — authors, artists, musicians, philosophers. Mostly stubs (title-only).
Plus 103 people entries from Roam import (see above).
Managed by: **people-librarian** skill (to be created).

### /data/books/ (261 files)

Source: `Data/Books/`
Frontmatter: `title`, `created`, `updated`. Content has read status, `#book` tag, `#by` author links, `#series`, `#queued`/`#started` dates.
Plus `Production Haskell (2023)` from `Writing/` (misfiled book, not user's writing).
Managed by: **book-librarian** skill (to be created).

### /data/gear/eurorack/ (64 files)

Source: `Data/Gear/Eurorack/` (including `Systems/` subfolder)
All gear files are Eurorack modules. No non-eurorack gear files exist.
Managed by: **eurorack-manager** skill (port from Obsidian).

### /data/relationships/ (53 files)

Source: `Data/Relationships/`
Personal contacts with `relation:` field in frontmatter (e.g. `relation: "zen community"`).
Plus Roni from Roam import.
Managed by: **relationships-manager** skill (port from Obsidian).

### /data/recipes/ (16 files)

Source: `Data/Recipes/`
Plus 4 recipes from Roam: Red Lentil Curry, Red Beans and Rice, Chana Masala, Pumpkin Pie.
Managed by: **recipe-librarian** skill (port from Obsidian).

### /data/software/ (6 files)

Source: `Data/Software/`
Sparse stubs. Managed by: skill TBD.

### /data/habits/ (5 files)

Source: `Data/Habits/`
Managed by: skill TBD.

### /data/businesses/ (3 files)

Source: `Data/Businesses/`
Rich entries with `type`, `phone`, `website` in frontmatter.
Managed by: **business-librarian** skill (port from Obsidian).

### /data/television/ (1 file)

Source: `Data/Television/`
Managed by: **media-librarian** skill (to be created, or merge with film-librarian).

### /data/games/ (1 file)

Source: `Data/Games/`
Note: the one entry (Civ 6 mods) has no frontmatter title — needs cleanup.
Managed by: skill TBD.

### /concepts/ (+98 from Data/Cleanup/)

Source: `Data/Cleanup/`
98 stubs — mixed media types (books, albums, films, games) never sorted into proper subfolders. All title-only, no content. Import as concepts; mine later with appropriate librarian skills.

### Skip

- `Data/Video Games/` — empty
- `Data/Music/` — empty

---

## Pass 1: Writing/ (105 files)

### /writing/ziusudra/ (81 files)

Source: `Writing/Ziusudra/`
Fully structured novel project: Characters/, Drafts/ (Outlines/, book-1/, book-2/), Factions/, Locations/, Lore/, Research/, Texts/, Process/. Has its own `.claude/` config.
Preserve subfolder structure in database path (e.g. `/writing/ziusudra/characters/...`).
Managed by: dedicated **ziusudra-literary-assistant** skill (scoped to this project).

### /writing/unfiled/ (23 files)

Source: `Writing/*.md` (loose files, excluding Production Haskell)
Includes:
- Ultan novel pieces: Writing The Trick, Writing The Disappearance of Ultan, Writing Into the Tower, Writing On Theurgy, Writing Raphael's Hand, Writing Shit Transformation Into Gold, Writing The Encounter on the Mountain, Writing code sutra, Ultan Novel Master Outline
- Meditative writing series (5 files)
- Therapy Journal
- Weekly journals (5 files from 2021)
- Journal April 5, 2020
- plague doctors of the 2020 Pandemic
- meditative writing (overview)

All imported as `/writing/unfiled/` for later organization.

---

## Pass 1: Projects/ (134 files)

### /projects/ (preserve subfolder structure)

Source: `Projects/`
Contents:
- `Building Your First Light Saber/` — project with Assets/, Sessions/, own CLAUDE.md
- `Obsidian Exocortex Setup.md`
- `Product - AI Loremaster.md`
- `Self-Hosted Music Library.md`

Plus ~22 standalone projects from Roam import (see above).

---

## Pass 1: Work/ (164 files)

### /work/ (preserve subfolder structure)

Source: `Work/`

| Subfolder | Files | Content |
|---|---|---|
| Projects/ | 129 | Work tickets and projects (includes Archive/) |
| People/ | 23 | Coworker notes |
| Teams/ | 3 | Team notes |
| Environments/ | 2 | Environment configs |
| Services/ | 1 | Service documentation |
| Initiatives/ | 1 | Initiative notes |
| Admin/ | 1 | Admin notes |
| (loose files) | 4 | DTO Log, Organization Notes, Retrospective Notes, Tech Debt Notes |

Plus ~48 entries from Roam import → `/work/unfiled/`.
Managed by: **work-project** skill (port from Obsidian `work-project-bootstrap`).

---

## Pass 1: Periodic Notes/ (1,460 files)

### /periodic-notes/daily/ (1,456 files)

Source: `Periodic Notes/Daily/`
Date range: 2020-03-15 through 2026-04-17 (6 years).
Type: `log`. Date extracted from filename. Import all entries.
Managed by: **journal** skill (port from Obsidian `daily-note-bootstrap`).

### /periodic-notes/weekly/ (4 files)

Source: `Periodic Notes/Weekly/`
Date range: 2026-03-23 through 2026-04-13 (recent only).
Managed by: **journal** skill.

---

## Pass 1: Studio/ (1 file)

### /studio/productions/ (1 file)

Source: `Studio/Productions/Hippasus.md`
Plus 5 entries from Roam import (Live Setup, song-titles, Band Names, Recent New Music, Music Production Priorities).
Managed by: **music-producer** skill (port from Obsidian).

---

## Pass 1: System/ (39 files)

Cherry-pick useful agent definitions and templates. Skip Obsidian-specific config (markdown-formatter, pdf-exporter, Roam scripts, etc.). Useful content feeds into Pass 3 (subagent definitions).

---

## Pass 2: Link Resolution

After all entries are inserted:

1. Build complete `title → GUID` index from all inserted entries
2. For every entry with content:
   - Parse `[[wikilinks]]` → look up GUID → store in `metadata.links`
   - Parse `#tags` and `#[[tags]]` → store in `metadata.tags`
   - Convert `#[[Roam-Highlights]]` → tag `roam-highlight`
   - Convert `#[[Quick Capture]]` → tag `quick-capture`
3. Update each entry's metadata via `mcp__talos__update`

---

## Pass 3: Subagent Definitions

Port Obsidian skills and create new ones. Each subagent manages a scoped ontology with its own metadata rules. Stored at `/system/agents/<name>`.

### Ported from Obsidian

| Obsidian Skill | Talos Subagent | Subtree |
|---|---|---|
| recipe-librarian | recipe-librarian | /data/recipes |
| business-librarian | business-librarian | /data/businesses |
| relationships-manager | relationships-manager | /data/relationships |
| eurorack-manager | eurorack-manager | /data/gear/eurorack |
| studio-engineer | studio-engineer | /data/gear, /studio |
| music-producer | music-producer | /studio |
| literary-assistant | literary-assistant | /writing |
| lidarr-manager | lidarr-manager | /data/music |
| work-project-bootstrap | work-project | /work |
| daily-note-bootstrap | journal | /periodic-notes |
| weekly-note-bootstrap | (merge into journal) | /periodic-notes |

### New subagents needed

| Subagent | Subtree | Purpose |
|---|---|---|
| film-librarian | /data/films | Manage film entries, watch status, directors, tags |
| book-librarian | /data/books | Manage book entries, read status, authors, series |
| people-librarian | /data/people | Manage public figure entries (person/artist/band) |
| media-librarian | /data/television | TV shows (may merge with film-librarian) |
| ziusudra-literary-assistant | /writing/ziusudra | Scoped literary assistant for the Ziusudra novel project |
| concept-miner | /concepts | Triage and reclassify concepts into proper ontologies |

### Skills that become Talos-level procedures (not subagents)

- markdown-formatter → not needed (Talos stores clean markdown)
- pdf-exporter → deferred until presentation layer exists
- write-a-skill → existing `subagent-create` skill in CLAUDE.md

Read each SKILL.md, adapt to Talos subagent format, insert at `/system/agents/<name>`.

---

## Batch Strategy

- Insert in batches of ~50 to avoid overwhelming the MCP layer
- Deduplicate: search by path before inserting; update if exists
- Tag all imported entries with `metadata.source: "obsidian"`
