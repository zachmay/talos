// Live-mode link scanner: called from insert/update tool hooks to keep the
// links table consistent with each entry's content.
//
// Scans content for [[wikilinks]] and #tags, resolves to target entry UUIDs,
// auto-creates tag stub entries at /tags/<name>, and replaces all outgoing
// edges for the given source entry.
//
// In strict mode (default for live writes), throws DanglingLinkError or
// AmbiguousLinkError on wikilinks that cannot resolve uniquely. Permissive
// mode (used by the bulk Pass 2 resolver) stores unresolved edges with
// target_id NULL and candidates[] populated when ambiguous.

import type { PoolClient } from "pg";

// --- Error types ---

export class DanglingLinkError extends Error {
  constructor(public linkText: string) {
    super(`DANGLING_LINK: [[${linkText}]] does not resolve to any entry`);
    this.name = "DanglingLinkError";
  }
}

export class AmbiguousLinkError extends Error {
  constructor(public linkText: string, public candidates: string[]) {
    super(`AMBIGUOUS_LINK: [[${linkText}]] matches ${candidates.length} entries: ${candidates.join(", ")}`);
    this.name = "AmbiguousLinkError";
  }
}

// --- Extraction ---

const WIKILINK_RE = /\[\[([^\]\n]+?)\]\]/g;
const BARE_TAG_RE = /(?<![\w\])/"'=])#([A-Za-z][\w/-]*)/g;
const BRACKETED_TAG_RE = /#\[\[([^\]\n]+?)\]\]/g;
const FENCED_CODE_RE = /```[\s\S]*?```|~~~[\s\S]*?~~~/gm;
const INLINE_CODE_RE = /`[^`\n]+?`/g;

function stripCode(content: string): string {
  return content.replace(FENCED_CODE_RE, "").replace(INLINE_CODE_RE, "");
}

function extractWikilinks(content: string): string[] {
  const clean = stripCode(content);
  const seen = new Set<string>();
  const result: string[] = [];
  const re = new RegExp(WIKILINK_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(clean)) !== null) {
    const start = match.index;
    // Skip if preceded by ! (embed) or # (bracketed tag)
    if (start > 0 && (clean[start - 1] === "!" || clean[start - 1] === "#")) continue;
    const text = match[1].trim();
    if (text && !seen.has(text)) {
      seen.add(text);
      result.push(text);
    }
  }
  return result;
}

function extractTags(content: string): string[] {
  const clean = stripCode(content);
  const seen = new Set<string>();
  const result: string[] = [];
  // Bracketed first (matches #[[Quick Capture]])
  const bracketedRe = new RegExp(BRACKETED_TAG_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = bracketedRe.exec(clean)) !== null) {
    const t = match[1].trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      result.push(t);
    }
  }
  // Then bare tags
  const bareRe = new RegExp(BARE_TAG_RE.source, "g");
  while ((match = bareRe.exec(clean)) !== null) {
    const t = match[1].trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      result.push(t);
    }
  }
  return result;
}

const SPECIAL_TAGS: Record<string, string> = {
  "Roam-Highlights": "roam-highlight",
  "Quick Capture": "quick-capture",
};

function normalizeTag(name: string): string {
  if (name in SPECIAL_TAGS) return SPECIAL_TAGS[name];
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

// --- Resolution ---

async function resolveWikilink(
  client: PoolClient,
  linkText: string
): Promise<{ targetId: string | null; candidates: string[] }> {
  // Alias syntax "foo|Bar" → use "foo" for resolution; "Bar" is display-only
  const text = linkText.split("|", 1)[0].trim();

  if (text.includes("/")) {
    // Path-qualified: "data/foo"
    const parts = text.split("/");
    const title = parts[parts.length - 1];
    const pathPrefix = parts.slice(0, -1);

    // Exact path + title match
    const exact = await client.query(
      `SELECT id FROM entries WHERE title = $1 AND path = $2::text[]`,
      [title, pathPrefix]
    );
    if (exact.rows.length === 1) return { targetId: exact.rows[0].id, candidates: [] };
    if (exact.rows.length > 1) return { targetId: null, candidates: exact.rows.map((r) => r.id) };

    // Fallback: any entry with this title whose path ends with pathPrefix
    const all = await client.query(`SELECT id, path FROM entries WHERE title = $1`, [title]);
    const filtered = all.rows.filter((r: any) => {
      const p: string[] = r.path ?? [];
      if (p.length < pathPrefix.length) return false;
      return p.slice(-pathPrefix.length).every((s, i) => s === pathPrefix[i]);
    });
    if (filtered.length === 1) return { targetId: filtered[0].id, candidates: [] };
    if (filtered.length > 1) return { targetId: null, candidates: filtered.map((r: any) => r.id) };
    return { targetId: null, candidates: [] };
  }

  // Unqualified: match by title only
  const result = await client.query(`SELECT id FROM entries WHERE title = $1`, [text]);
  if (result.rows.length === 1) return { targetId: result.rows[0].id, candidates: [] };
  if (result.rows.length > 1) return { targetId: null, candidates: result.rows.map((r: any) => r.id) };
  return { targetId: null, candidates: [] };
}

async function ensureTagStub(client: PoolClient, normalizedName: string): Promise<string> {
  // Check if stub exists
  const existing = await client.query(
    `SELECT id FROM entries
     WHERE path = ARRAY['tags', $1]::text[] AND array_length(path, 1) = 2
     LIMIT 1`,
    [normalizedName]
  );
  if (existing.rows.length > 0) return existing.rows[0].id;

  // Create stub
  const meta = { _import: { source: "auto-created" } };
  const inserted = await client.query(
    `INSERT INTO entries (content, path, title, type, metadata, agent_id)
     VALUES ('', ARRAY['tags', $1]::text[], $1, 'tag', $2::jsonb, current_setting('app.agent_id'))
     RETURNING id`,
    [normalizedName, JSON.stringify(meta)]
  );
  return inserted.rows[0].id;
}

async function createConceptStub(
  client: PoolClient,
  linkText: string
): Promise<string> {
  // Alias syntax "foo|Bar" — use "foo" as the new entry's title/path
  const text = linkText.split("|", 1)[0].trim();

  let stubPath: string[];
  let stubTitle: string;
  if (text.includes("/")) {
    // Path-qualified: create at the specified path
    const parts = text.split("/");
    stubTitle = parts[parts.length - 1];
    stubPath = parts.slice(0, -1).concat([stubTitle]);
  } else {
    // Unqualified: default to /concepts/<name>
    stubTitle = text;
    stubPath = ["concepts", text];
  }

  const meta = { _import: { source: "auto-created" } };
  const inserted = await client.query(
    `INSERT INTO entries (content, path, title, type, metadata, agent_id)
     VALUES ('', $1::text[], $2, 'concept', $3::jsonb, current_setting('app.agent_id'))
     RETURNING id`,
    [stubPath, stubTitle, JSON.stringify(meta)]
  );
  return inserted.rows[0].id;
}

// --- Main scan function ---

type LinkRow = {
  targetId: string | null;
  linkText: string;
  linkType: "wikilink" | "tag";
  candidates: string[];
};

export type ScanMode = "strict" | "permissive";

export async function scanAndStoreLinks(
  client: PoolClient,
  agentId: string,
  sourceId: string,
  content: string,
  mode: ScanMode = "strict"
): Promise<{ wikilinks: number; tags: number; tagStubsCreated: number; conceptStubsCreated: number }> {
  const wikilinks = extractWikilinks(content);
  const tags = extractTags(content);

  const rows: LinkRow[] = [];
  let conceptStubsCreated = 0;

  // Resolve wikilinks
  for (const text of wikilinks) {
    const { targetId, candidates } = await resolveWikilink(client, text);
    if (targetId) {
      rows.push({ targetId, linkText: text, linkType: "wikilink", candidates: [] });
    } else if (candidates.length >= 2) {
      // Ambiguous — never auto-resolve
      if (mode === "strict") throw new AmbiguousLinkError(text, candidates);
      rows.push({ targetId: null, linkText: text, linkType: "wikilink", candidates });
    } else if (mode === "strict") {
      // Dangling — auto-create stub (concept-graph philosophy)
      const stubId = await createConceptStub(client, text);
      conceptStubsCreated++;
      rows.push({ targetId: stubId, linkText: text, linkType: "wikilink", candidates: [] });
    } else {
      // Permissive: leave dangling for import-time audit
      rows.push({ targetId: null, linkText: text, linkType: "wikilink", candidates: [] });
    }
  }

  // Resolve/create tag stubs
  let tagStubsCreated = 0;
  for (const tag of tags) {
    const normalized = normalizeTag(tag);
    // Track whether this created a new stub (before lookup)
    const wasExisting = await client.query(
      `SELECT 1 FROM entries WHERE path = ARRAY['tags', $1]::text[] AND array_length(path, 1) = 2 LIMIT 1`,
      [normalized]
    );
    const stubId = await ensureTagStub(client, normalized);
    if (wasExisting.rows.length === 0) tagStubsCreated++;
    rows.push({ targetId: stubId, linkText: tag, linkType: "tag", candidates: [] });
  }

  // Replace all outgoing edges for this source
  await client.query(`DELETE FROM links WHERE source_id = $1`, [sourceId]);

  if (rows.length === 0) {
    return { wikilinks: wikilinks.length, tags: tags.length, tagStubsCreated, conceptStubsCreated };
  }

  // Dedupe by (link_type, link_text) — same as Pass 2 scanner
  const seenKeys = new Set<string>();
  const uniqueRows = rows.filter((r) => {
    const k = `${r.linkType}:${r.linkText}`;
    if (seenKeys.has(k)) return false;
    seenKeys.add(k);
    return true;
  });

  for (const row of uniqueRows) {
    await client.query(
      `INSERT INTO links (agent_id, source_id, target_id, link_text, link_type, candidates)
       VALUES ($1, $2, $3, $4, $5::link_type, $6)`,
      [
        agentId,
        sourceId,
        row.targetId,
        row.linkText,
        row.linkType,
        row.candidates.length >= 2 ? row.candidates : null,
      ]
    );
  }

  return { wikilinks: wikilinks.length, tags: tags.length, tagStubsCreated };
}
