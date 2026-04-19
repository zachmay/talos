# Graph DB / Link Resolution Design

## Core decision: UUID markdown links + links-as-edges table

Move away from Obsidian-style `[[wikilinks]]` to standard markdown links with UUID targets: `[Display Text](uuid-of-target)`. The UI builds these at authoring time using the target's current title. A links table stores the resulting graph edges and enables fast backlink / traversal queries.

## Content format

```markdown
A [morphism](ccc-333-...) is an arrow. See also [Aristotle](bbb-222-...).
```

- Display text is what the user sees and what embeds meaningfully
- UUID is the stable target reference
- Standard markdown — no custom parser needed for rendering

## Embedding quality

UUIDs add ~15 junk tokens per link. Mitigate by stripping UUIDs before sending content to the embedding model:

```python
re.sub(r'\[([^\]]+)\]\([0-9a-f\-]+\)', r'[[\1]]', content)
# "A [morphism](ccc-333) is an arrow" → "A [[morphism]] is an arrow"
```

The content field stores the full UUID-linked form (authoritative). The embedding uses the stripped form (clean semantics).

## Links table = graph edges

```sql
CREATE TABLE links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  target_id uuid REFERENCES entries(id) ON DELETE SET NULL,
  link_type text NOT NULL,          -- 'wikilink', 'tag', 'embed', 'mention'
  display_text text,                -- what appeared in the brackets
  position int,                     -- optional: char offset in source content
  context text,                     -- optional: surrounding text snippet
  UNIQUE (source_id, target_id, link_type, position)
);
CREATE INDEX ON links(source_id);
CREATE INDEX ON links(target_id);
CREATE INDEX ON links(link_type);
```

**Nodes** = entries. **Edges** = links rows. Typed, directional, attributed.

## Query patterns

```sql
-- Backlinks: what points to this entry?
SELECT e.* FROM entries e JOIN links l ON l.source_id = e.id WHERE l.target_id = $1;

-- Neighborhood: 2-hop traversal
WITH RECURSIVE neighbors AS (
  SELECT target_id AS id, 1 AS depth FROM links WHERE source_id = $1
  UNION
  SELECT l.target_id, n.depth + 1 FROM links l JOIN neighbors n ON l.source_id = n.id
  WHERE n.depth < 2
)
SELECT * FROM entries WHERE id IN (SELECT id FROM neighbors);

-- All entries with tag #foo
SELECT e.* FROM entries e JOIN links l ON l.source_id = e.id
WHERE l.link_type = 'tag' AND l.target_id = (SELECT id FROM entries WHERE metadata->>'title' = 'foo');
```

## Ingest-time link scanning

On insert/update, a post-commit step scans content for:
1. Markdown links `[text](uuid)` → insert `link_type='wikilink'` row with target_id
2. Tags `#foo` or `#[[foo]]` → resolve tag name to entry at `/tags/foo`, insert `link_type='tag'` row
3. Embeds `![text](uuid)` → insert `link_type='embed'` row

Idempotent: before inserting, delete existing links where `source_id = this_entry`.

## Rename handling

When an entry's title changes:
1. Find all entries where content references this entry's UUID (via links table: `SELECT DISTINCT source_id FROM links WHERE target_id = $1`)
2. For each source, rewrite the display text in the markdown link to the new title
3. Re-embed each updated source (content changed)

This is a real cost. Batch it async; in a personal KB renames are rare.

## Ambiguity: eliminated by construction

The UUID markdown approach makes ambiguity impossible at author time:
- The UI picker forces you to select a specific entry
- The UUID in the link IS the resolution

No `[[foo]]` vs `[[data/foo]]` problem because there's no bare reference to resolve.

## Dangling links

If a target is deleted, `ON DELETE SET NULL` leaves the link row with `target_id = NULL`. The content still has the UUID embedded, but the edge is broken. Display layer renders these as dead links. A cleanup job can periodically find and report them.

## Why not Neo4j?

Postgres + recursive CTEs handles 1-2 hop queries (the 95% case for a personal KB) cleanly. Neo4j advantages — Cypher syntax, fast deep traversals, built-in graph algorithms (PageRank, community detection) — are nice but not essential. If we need them later, [Apache AGE](https://age.apache.org/) adds Cypher + algorithms to Postgres as an extension.

**Tradeoff:** we're giving up convenience for deep-graph operations, not capability.

## Migration from current Obsidian wikilinks

The import currently preserves `[[wikilinks]]` in content. To move to the UUID-link model:

1. Build the title → GUID index (already have this: `title-guid-index.json`)
2. For each entry, scan content for `[[text]]` and `[[path/text]]`:
   - Resolve to UUID via index
   - If ambiguous (multiple matches), flag for manual disambiguation
   - If dangling (no match), either auto-create a stub at `/concepts/` or flag
3. Rewrite content: `[[morphism]]` → `[morphism](<uuid>)`
4. Re-embed rewritten content
5. Populate links table from scan results

This is Pass 2 of the import. The existing wikilink-preserving content is a valid intermediate state.

## Open questions

- **Tags as entries?** If tags are graph nodes (targets of `link_type='tag'` edges), they need to be first-class entries at `/tags/<name>`. Auto-create on first use, like Roam. Alternative: keep `metadata.tags` as an array and don't model tags as edges.
- **UI picker implementation** — the authoring experience depends on this. For bulk-inserted content (imports), we resolve offline via script; for user authoring, the UI needs live search against titles.
- **Embed handling (`![[foo]]` or `![foo](uuid)`)** — same mechanism as links but with `link_type='embed'`. The display layer pulls the target's content inline.
