#!/usr/bin/env python3
"""Pass 2 — Link resolution.

Scans every entry's content for wikilinks and tags, resolves each to a
target entry UUID, and inserts rows into the `links` table.

For tags, auto-creates stub entries at /tags/<name> on demand.
For ambiguous wikilinks, writes a report file for manual resolution but
skips inserting the DB row (the link is left unrepresented until the author
disambiguates the source content).
For dangling wikilinks, stores row with target_id=NULL (permissive mode).

Writes audit artifacts to import-audit/:
  - pass2-report.md
  - ambiguous-links.md
  - dangling-links.md
  - tag-stubs-created.txt
"""

import json
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

AUDIT = Path(__file__).parent
AGENT_ID = "default-agent"

# --- DB helpers (direct via docker exec) ---

def psql_query(sql):
    """Run a SELECT, return parsed JSON lines."""
    wrapped = f"SET app.agent_id = '{AGENT_ID}'; {sql}"
    result = subprocess.run(
        ["docker", "compose", "exec", "-T", "db",
         "psql", "-U", "mcp_service", "-d", "talos",
         "-t", "-A", "-c", wrapped],
        capture_output=True, text=True, check=True,
    )
    rows = []
    for line in result.stdout.strip().split("\n"):
        line = line.strip()
        if not line or line == "SET":
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            pass
    return rows


def psql_exec(sql):
    """Run an INSERT/UPDATE/DELETE or DDL."""
    wrapped = f"SET app.agent_id = '{AGENT_ID}'; {sql}"
    subprocess.run(
        ["docker", "compose", "exec", "-T", "db",
         "psql", "-U", "mcp_service", "-d", "talos", "-q", "-c", wrapped],
        capture_output=True, text=True, check=True,
    )


def psql_exec_stdin(sql):
    """Run a SQL script from stdin (for batch inserts)."""
    subprocess.run(
        ["docker", "compose", "exec", "-T", "db",
         "psql", "-U", "mcp_service", "-d", "talos", "-q"],
        input=f"SET app.agent_id = '{AGENT_ID}';\n" + sql,
        text=True, check=True, capture_output=True,
    )


# --- SQL escaping ---

def esc(s):
    """Escape a string for SQL single-quoted literal."""
    if s is None:
        return "NULL"
    return "'" + str(s).replace("'", "''") + "'"


def esc_array(items):
    """Escape a Python list as a Postgres array literal."""
    if not items:
        return "NULL"
    parts = ",".join(esc(x) for x in items)
    return f"ARRAY[{parts}]"


def esc_uuid_array(uuids):
    """Escape a list of UUID strings."""
    if not uuids:
        return "NULL"
    parts = ",".join(esc(u) + "::uuid" for u in uuids)
    return f"ARRAY[{parts}]"


# --- Load entries and build indexes ---

def load_entries():
    """Return all entries as list of dicts."""
    rows = psql_query(
        "SELECT json_build_object("
        "'id', id, "
        "'content', content, "
        "'path', path, "
        "'title', title, "
        "'type', type, "
        "'metadata', metadata) "
        "FROM entries;"
    )
    return rows


def build_title_index(entries):
    """Build {title: [entry]} and {(path_tuple, title): [entry]} indexes."""
    by_title = defaultdict(list)
    by_path_title = defaultdict(list)
    for e in entries:
        title = e.get("title") or ""
        if not title:
            continue
        by_title[title].append(e)
        # Indexed by path tuple + title for path-qualified lookups
        path = tuple(e.get("path") or [])
        by_path_title[(path, title)].append(e)
    return by_title, by_path_title


# --- Link extraction ---

WIKILINK_RE = re.compile(r"\[\[([^\]\n]+?)\]\]")
# Match #tag or #[[tag name]] — word chars, slash, hyphen (not markdown headers)
BARE_TAG_RE = re.compile(r"(?<![\w\])/\"'=])#([A-Za-z][\w/-]*)")
BRACKETED_TAG_RE = re.compile(r"#\[\[([^\]\n]+?)\]\]")

# Code blocks to strip before scanning (so we don't match #code_field or [[in_code]])
FENCED_CODE_RE = re.compile(r"```[\s\S]*?```|~~~[\s\S]*?~~~", re.MULTILINE)
INLINE_CODE_RE = re.compile(r"`[^`\n]+?`")


def strip_code(content):
    """Remove fenced and inline code blocks so their contents aren't scanned."""
    content = FENCED_CODE_RE.sub("", content)
    content = INLINE_CODE_RE.sub("", content)
    return content


def extract_wikilinks(content):
    """Return list of unique bracket texts from wikilinks. Code blocks stripped."""
    content = strip_code(content)
    seen = set()
    result = []
    for match in WIKILINK_RE.finditer(content):
        start = match.start()
        # Skip if preceded by ! or #
        if start > 0 and content[start - 1] in "!#":
            continue
        text = match.group(1).strip()
        if text and text not in seen:
            seen.add(text)
            result.append(text)
    return result


def extract_tags(content):
    """Return list of unique tag names (original form). Code blocks stripped."""
    content = strip_code(content)
    seen = set()
    result = []
    for match in BRACKETED_TAG_RE.finditer(content):
        t = match.group(1).strip()
        if t and t not in seen:
            seen.add(t)
            result.append(t)
    for match in BARE_TAG_RE.finditer(content):
        t = match.group(1).strip()
        if t and t not in seen:
            seen.add(t)
            result.append(t)
    return result


def normalize_tag(name):
    """Normalize tag name for storage at /tags/<name>."""
    s = name.strip()
    # Special cases per plan
    specials = {
        "Roam-Highlights": "roam-highlight",
        "Quick Capture": "quick-capture",
    }
    if s in specials:
        return specials[s]
    # Lowercase, replace spaces with hyphens
    s = s.lower().replace(" ", "-")
    return s


# --- Wikilink resolution ---

def resolve_wikilink(link_text, by_title, by_path_title):
    """Return (target_id, candidates) where candidates is None if not ambiguous.

    target_id: str or None
    candidates: list of str or None
    """
    # Alias syntax: "foo|Bar" → use "foo" for resolution
    text = link_text.split("|", 1)[0].strip()

    # Path-qualified: "data/foo"
    if "/" in text:
        parts = text.split("/")
        title = parts[-1]
        path_parts = tuple(parts[:-1])
        matches = by_path_title.get((path_parts, title), [])
        if len(matches) == 1:
            return matches[0]["id"], None
        if len(matches) > 1:
            return None, [m["id"] for m in matches]
        # Try case where full path matches prefix
        # Scan all entries with this title, prefer one whose path ends with path_parts
        matches = by_title.get(title, [])
        filtered = [m for m in matches if tuple(m.get("path") or [])[-len(path_parts):] == path_parts]
        if len(filtered) == 1:
            return filtered[0]["id"], None
        if len(filtered) > 1:
            return None, [m["id"] for m in filtered]
        return None, None  # dangling

    # Unqualified
    matches = by_title.get(text, [])
    if len(matches) == 1:
        return matches[0]["id"], None
    if len(matches) > 1:
        return None, [m["id"] for m in matches]
    return None, None  # dangling


# --- Tag stub creation (batched) ---

def build_tag_stubs(all_tag_names):
    """Given a set of normalized tag names, ensure each has a stub at /tags/<name>.
    Returns {normalized_name: uuid} for all tags.
    Batched: one query for existing, one bulk insert for missing.
    """
    if not all_tag_names:
        return {}

    # Find existing tag stubs in one query
    name_list = ",".join(esc(n) for n in sorted(all_tag_names))
    rows = psql_query(
        f"SELECT json_build_object('id', id, 'name', title) FROM entries "
        f"WHERE path[1] = 'tags' "
        f"AND array_length(path, 1) = 2 "
        f"AND title IN ({name_list});"
    )
    cache = {row["name"]: row["id"] for row in rows}

    # Batch insert missing
    missing = [n for n in all_tag_names if n not in cache]
    if missing:
        values = []
        for name in missing:
            meta = {"_import": {"source": "auto-created"}}
            values.append(
                f"('', ARRAY['tags', {esc(name)}]::text[], "
                f"{esc(name)}, 'tag', "
                f"{esc(json.dumps(meta))}::jsonb, {esc(AGENT_ID)})"
            )
        sql = (
            "INSERT INTO entries (content, path, title, type, metadata, agent_id) VALUES "
            + ",".join(values)
            + " RETURNING id, title;"
        )
        # Run via stdin to get output
        subprocess.run(
            ["docker", "compose", "exec", "-T", "db",
             "psql", "-U", "mcp_service", "-d", "talos", "-t", "-A", "-c",
             f"SET app.agent_id = '{AGENT_ID}'; {sql}"],
            capture_output=True, text=True, check=True,
        )
        # Re-query to get the newly-inserted UUIDs
        rows = psql_query(
            f"SELECT json_build_object('id', id, 'name', title) FROM entries "
            f"WHERE path[1] = 'tags' "
            f"AND array_length(path, 1) = 2 "
            f"AND title IN ({','.join(esc(n) for n in missing)});"
        )
        for row in rows:
            cache[row["name"]] = row["id"]

    return cache


# --- Main ---

def main():
    print("Loading entries from DB...")
    entries = load_entries()
    print(f"  {len(entries)} entries")

    print("Building title index...")
    by_title, by_path_title = build_title_index(entries)
    print(f"  {len(by_title)} unique titles; {sum(len(v) > 1 for v in by_title.values())} with duplicates")

    # Pass A: scan all content, collect everything we need
    print("Scanning content (pass A: collect)...")
    scan_results = []  # list of (source_id, wikilink_texts, tag_texts, entry)
    all_tag_names = set()

    for i, e in enumerate(entries):
        content = e.get("content") or ""
        if not content.strip():
            continue
        source_id = e["id"]
        wikilinks = extract_wikilinks(content)
        tags = [(t, normalize_tag(t)) for t in extract_tags(content)]
        for _, norm in tags:
            all_tag_names.add(norm)
        scan_results.append((source_id, wikilinks, tags, e))
        if (i + 1) % 1000 == 0:
            print(f"  [{i+1}/{len(entries)}] scanned")

    print(f"  {len(scan_results)} entries with content")
    print(f"  {len(all_tag_names)} unique normalized tags")

    # Pass B: batch-create tag stubs
    print("\nCreating tag stubs...")
    tag_stubs_cache = build_tag_stubs(all_tag_names)
    print(f"  {len(tag_stubs_cache)} tag stubs ready")

    # Pass C: resolve wikilinks and build link rows
    print("\nResolving wikilinks and building link rows...")
    link_rows = []          # list of (source_id, target_id, link_text, link_type)
    ambiguous_records = []  # (source_entry, link_text, link_type, candidates) — report only
    dangling_records = []   # (source_entry, link_text, link_type)

    for source_id, wikilinks, tags, e in scan_results:
        for link_text in wikilinks:
            target_id, candidates = resolve_wikilink(link_text, by_title, by_path_title)
            if target_id:
                link_rows.append((source_id, target_id, link_text, "wikilink"))
            elif candidates:
                # Ambiguous — don't insert; just report for manual disambiguation
                ambiguous_records.append((e, link_text, "wikilink", candidates))
            else:
                # Dangling — insert with target_id NULL (permissive mode)
                link_rows.append((source_id, None, link_text, "wikilink"))
                dangling_records.append((e, link_text, "wikilink"))

        for tag_original, normalized in tags:
            tag_uuid = tag_stubs_cache[normalized]
            link_rows.append((source_id, tag_uuid, tag_original, "tag"))

    print(f"\nTotal link rows to insert: {len(link_rows)}")
    print(f"Tag stubs:                  {len(tag_stubs_cache)}")

    # --- Deduplicate link rows by (source_id, link_type, link_text) ---
    # Keep first occurrence — resolution is deterministic so dupes have same target
    seen_keys = set()
    unique_rows = []
    for row in link_rows:
        source_id, target_id, link_text, link_type = row
        key = (source_id, link_type, link_text)
        if key not in seen_keys:
            seen_keys.add(key)
            unique_rows.append(row)
    print(f"After dedup: {len(unique_rows)} rows")

    # --- Batch insert links ---
    print("\nInserting links in batches...")
    BATCH = 500
    for i in range(0, len(unique_rows), BATCH):
        batch = unique_rows[i : i + BATCH]
        values = []
        for source_id, target_id, link_text, link_type in batch:
            tid = f"{esc(target_id)}::uuid" if target_id else "NULL"
            values.append(
                f"({esc(AGENT_ID)}, {esc(source_id)}::uuid, {tid}, "
                f"{esc(link_text)}, {esc(link_type)}::link_type)"
            )
        sql = (
            "INSERT INTO links (agent_id, source_id, target_id, link_text, link_type) VALUES "
            + ",".join(values)
            + " ON CONFLICT (source_id, link_type, link_text) DO NOTHING;"
        )
        psql_exec_stdin(sql)
        print(f"  inserted {min(i + BATCH, len(unique_rows))}/{len(unique_rows)}")

    # --- Write audit artifacts ---
    print("\nWriting audit artifacts...")

    # Summary report
    total_wikilinks = sum(1 for r in unique_rows if r[3] == "wikilink")
    total_tags = sum(1 for r in unique_rows if r[3] == "tag")
    resolved = sum(1 for r in unique_rows if r[1] is not None)
    ambiguous = len(ambiguous_records)
    dangling = len(dangling_records)

    with open(AUDIT / "pass2-report.md", "w") as f:
        f.write("# Pass 2 — Link Resolution Report\n\n")
        f.write(f"- Total edges: {len(unique_rows)}\n")
        f.write(f"  - Wikilinks: {total_wikilinks}\n")
        f.write(f"  - Tags: {total_tags}\n")
        f.write(f"- Resolved: {resolved}\n")
        f.write(f"- Ambiguous: {ambiguous}\n")
        f.write(f"- Dangling: {dangling}\n")
        f.write(f"- Tag stubs created: {len(tag_stubs_cache)}\n")

    with open(AUDIT / "ambiguous-links.md", "w") as f:
        f.write(f"# Ambiguous Links ({len(ambiguous_records)})\n\n")
        for entry, link_text, link_type, candidates in ambiguous_records:
            f.write(f"## `{link_text}` in {entry.get('metadata', {}).get('original-source') or entry.get('title')}\n")
            f.write(f"- Source id: {entry['id']}\n")
            f.write(f"- Link type: {link_type}\n")
            f.write(f"- Candidates:\n")
            for c in candidates:
                # Look up candidate title
                match = next((e for e in entries if e["id"] == c), None)
                if match:
                    path_str = "/" + "/".join(match.get("path") or [])
                    f.write(f"  - `{c}` — {match.get('title')} at {path_str}\n")
                else:
                    f.write(f"  - `{c}`\n")
            f.write("\n")

    with open(AUDIT / "dangling-links.md", "w") as f:
        f.write(f"# Dangling Links ({len(dangling_records)})\n\n")
        # Group by link_text for easier review
        by_link_text = defaultdict(list)
        for entry, link_text, link_type in dangling_records:
            by_link_text[(link_text, link_type)].append(entry)
        for (link_text, link_type), sources in sorted(by_link_text.items()):
            f.write(f"## `{link_text}` ({link_type}) — referenced by {len(sources)} entries\n")
            for source in sources[:20]:
                orig = source.get("metadata", {}).get("original-source") or source.get("title")
                f.write(f"- {orig}\n")
            if len(sources) > 20:
                f.write(f"- ... and {len(sources) - 20} more\n")
            f.write("\n")

    with open(AUDIT / "tag-stubs-created.txt", "w") as f:
        for name, uuid in sorted(tag_stubs_cache.items()):
            f.write(f"{uuid}\t{name}\n")

    print("\n--- SUMMARY ---")
    print(f"Total edges:    {len(unique_rows)}")
    print(f"  Wikilinks:    {total_wikilinks}")
    print(f"  Tags:         {total_tags}")
    print(f"Resolved:       {resolved}")
    print(f"Ambiguous:      {ambiguous}")
    print(f"Dangling:       {dangling}")
    print(f"Tag stubs:      {len(tag_stubs_cache)}")
    print(f"\nArtifacts in {AUDIT}/")


if __name__ == "__main__":
    main()
