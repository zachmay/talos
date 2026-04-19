#!/usr/bin/env python3
"""Verification for daily-note title normalization.

Usage:
  verify-normalization.py --preflight
      Scan for edge cases that would violate invariants post-change
      (e.g. files that already have BOTH prose and ISO forms of the
      same date, which would collapse into one link row).

  verify-normalization.py --snapshot <file.json>
      Capture DB state to a JSON file. Run before the change.

  verify-normalization.py --verify <before.json>
      Compare current DB state to the pre-snapshot; report invariants
      preserved, expected changes applied, and any surprises.
"""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

VAULT = Path.home() / "Documents" / "Exocortex"
AUDIT = Path(__file__).parent
AGENT_ID = "default-agent"

MONTH_NAMES = "January|February|March|April|May|June|July|August|September|October|November|December"
PROSE_DATE_RE = re.compile(rf"^({MONTH_NAMES}) \d+(st|nd|rd|th)?,? \d{{4}}$")
ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# Map month name to number
MONTHS = {m: i + 1 for i, m in enumerate(MONTH_NAMES.split("|"))}


def psql(sql):
    """Run a SELECT via docker psql. Return list of parsed JSON rows."""
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


def parse_prose_date(text):
    """Parse 'September 9th, 2020' / 'September 9, 2020' → '2020-09-09'. None if not a date."""
    m = re.match(rf"^({MONTH_NAMES}) (\d+)(st|nd|rd|th)?,? (\d{{4}})$", text)
    if not m:
        return None
    month = MONTHS[m.group(1)]
    day = int(m.group(2))
    year = int(m.group(4))
    return f"{year:04d}-{month:02d}-{day:02d}"


def snapshot():
    """Capture current state: counts + per-source link fingerprint for Category 2 files."""
    # Top-level counts
    entries_count = psql("SELECT json_build_object('n', count(*)) FROM entries;")[0]["n"]
    links_count = psql("SELECT json_build_object('n', count(*)) FROM links;")[0]["n"]
    chunks_count = psql("SELECT json_build_object('n', count(*)) FROM chunks;")[0]["n"]

    # Dailies with prose titles
    prose_dailies = psql(f"""
        SELECT json_build_object(
          'id', id,
          'title', title,
          'original', metadata->'_import'->>'original'
        ) FROM entries
        WHERE path = ARRAY['periodic-notes', 'daily']
          AND title !~ '^\\d{{4}}-\\d{{2}}-\\d{{2}}$';
    """)

    # Dangling prose-date wikilinks
    dangling_prose = psql(f"""
        SELECT json_build_object(
          'source_id', source_id,
          'link_text', link_text,
          'link_type', link_type::text
        ) FROM links
        WHERE target_id IS NULL
          AND link_text ~ '^({MONTH_NAMES}) \\d+(st|nd|rd|th)?,? \\d{{4}}$';
    """)

    # All dangling count for delta tracking
    total_dangling = psql("SELECT json_build_object('n', count(*)) FROM links WHERE target_id IS NULL;")[0]["n"]

    # Outgoing links from source entries that have prose-date wikilinks
    # (Category 2 source_ids — for fingerprinting)
    category2_source_ids = list({r["source_id"] for r in dangling_prose})
    category2_links = {}
    if category2_source_ids:
        id_list = ",".join(f"'{i}'::uuid" for i in category2_source_ids)
        rows = psql(f"""
            SELECT json_build_object(
              'source_id', source_id,
              'link_text', link_text,
              'link_type', link_type::text,
              'target_id', target_id
            ) FROM links WHERE source_id IN ({id_list});
        """)
        for row in rows:
            category2_links.setdefault(row["source_id"], []).append({
                "link_text": row["link_text"],
                "link_type": row["link_type"],
                "target_id": row["target_id"],
            })

    return {
        "counts": {
            "entries": entries_count,
            "links": links_count,
            "chunks": chunks_count,
            "prose_titled_dailies": len(prose_dailies),
            "dangling_prose_wikilinks": len(dangling_prose),
            "total_dangling_links": total_dangling,
        },
        "prose_titled_dailies": prose_dailies,
        "dangling_prose_wikilinks": dangling_prose,
        "category2_links": category2_links,
    }


def preflight():
    """Scan for edge cases that would violate post-change invariants."""
    print("Running preflight checks...")
    issues = []

    # Check 1: Category 2 files that already have both [[prose]] and [[ISO]]
    #          would collapse on rewrite → total link count decreases
    print("\n[1/2] Checking for files with both prose and ISO forms of same date...")
    dangling_prose = psql(f"""
        SELECT json_build_object(
          'source_id', source_id,
          'link_text', link_text
        ) FROM links
        WHERE target_id IS NULL
          AND link_text ~ '^({MONTH_NAMES}) \\d+(st|nd|rd|th)?,? \\d{{4}}$';
    """)

    for row in dangling_prose:
        iso = parse_prose_date(row["link_text"])
        if iso is None:
            continue
        existing = psql(f"""
            SELECT json_build_object('exists', (
              SELECT count(*) > 0 FROM links
              WHERE source_id = '{row["source_id"]}'::uuid
                AND link_text = {escape_sql(iso)}
            ));
        """)
        if existing and existing[0]["exists"]:
            issues.append(
                f"COLLAPSE: source {row['source_id']} has both "
                f"[[{row['link_text']}]] and [[{iso}]]"
            )

    # Check 2: Prose-titled dailies whose filename doesn't map to valid ISO
    print("[2/2] Checking prose-titled dailies have derivable ISO filenames...")
    prose_dailies = psql("""
        SELECT json_build_object(
          'id', id,
          'title', title,
          'original', metadata->'_import'->>'original'
        ) FROM entries
        WHERE path = ARRAY['periodic-notes', 'daily']
          AND title !~ '^\\d{4}-\\d{2}-\\d{2}$';
    """)
    for row in prose_dailies:
        src = row.get("original") or ""
        stem = src.rsplit("/", 1)[-1].replace(".md", "")
        if not ISO_DATE_RE.match(stem):
            issues.append(
                f"BAD_FILENAME: entry {row['id']} title={row['title']!r} "
                f"source={src!r} — filename is not ISO format"
            )

    print(f"\nPreflight complete. Issues: {len(issues)}")
    for issue in issues:
        print(f"  - {issue}")

    return issues


def escape_sql(s):
    """Escape a string for SQL single-quote literal."""
    return "'" + s.replace("'", "''") + "'"


def verify(before_path):
    """Compare current state to a pre-snapshot; report all checks."""
    with open(before_path) as f:
        before = json.load(f)
    after = snapshot()

    print("=" * 60)
    print("VERIFICATION REPORT")
    print("=" * 60)

    # --- Invariants ---
    print("\n--- Invariants (should NOT change) ---")
    check("entries count", before["counts"]["entries"], after["counts"]["entries"], same=True)
    check("links count",   before["counts"]["links"],   after["counts"]["links"],   same=True)

    # chunks intentionally not an invariant — re-chunking can shift counts slightly
    delta_chunks = after["counts"]["chunks"] - before["counts"]["chunks"]
    print(f"  chunks delta (informational): {delta_chunks:+d}")

    # --- Expected changes ---
    print("\n--- Expected changes ---")
    check("prose-titled dailies", before["counts"]["prose_titled_dailies"], after["counts"]["prose_titled_dailies"], expected_after=0)
    check("dangling prose wikilinks", before["counts"]["dangling_prose_wikilinks"], after["counts"]["dangling_prose_wikilinks"], expected_after=0)

    expected_delta = -before["counts"]["dangling_prose_wikilinks"]
    actual_delta = after["counts"]["total_dangling_links"] - before["counts"]["total_dangling_links"]
    status = "OK" if actual_delta == expected_delta else "FAIL"
    print(f"  [{status}] total dangling delta: expected {expected_delta:+d}, actual {actual_delta:+d}")

    # --- Cross-checks ---
    print("\n--- Cross-checks ---")
    # 1. Every daily title matches filename
    mismatched = psql("""
        SELECT json_build_object(
          'id', id,
          'title', title,
          'expected', regexp_replace(regexp_replace(metadata->'_import'->>'original', '.*/', ''), '\\.md$', '')
        ) FROM entries
        WHERE path = ARRAY['periodic-notes', 'daily']
          AND title != regexp_replace(regexp_replace(metadata->'_import'->>'original', '.*/', ''), '\\.md$', '');
    """)
    status = "OK" if not mismatched else "FAIL"
    print(f"  [{status}] daily title == filename: {len(mismatched)} mismatches")
    for m in mismatched[:5]:
        print(f"      {m['id']}: title={m['title']!r} expected={m['expected']!r}")

    # 2. Referential integrity — no non-null target pointing to missing entry
    orphan_targets = psql("""
        SELECT json_build_object('n', count(*)) FROM links l
        WHERE target_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM entries WHERE id = l.target_id);
    """)
    n_orphan = orphan_targets[0]["n"] if orphan_targets else 0
    status = "OK" if n_orphan == 0 else "FAIL"
    print(f"  [{status}] orphan link targets: {n_orphan}")

    # 3. Category 2 files: prose wikilinks replaced, non-prose unchanged
    print("\n--- Category 2 file link checks ---")
    for source_id, before_links in before.get("category2_links", {}).items():
        # Query current links for this source
        rows = psql(f"""
            SELECT json_build_object(
              'link_text', link_text,
              'link_type', link_type::text,
              'target_id', target_id
            ) FROM links WHERE source_id = '{source_id}'::uuid;
        """)
        current_texts = {(r["link_text"], r["link_type"]) for r in rows}
        before_texts = {(l["link_text"], l["link_type"]) for l in before_links}

        # Any old prose-date link_text should be gone
        old_prose = [(t, ty) for t, ty in before_texts if PROSE_DATE_RE.match(t) and ty == "wikilink"]
        still_there = [x for x in old_prose if x in current_texts]
        if still_there:
            print(f"  FAIL source {source_id}: prose wikilinks still present: {still_there}")

        # Any ISO-date wikilink present now should have target_id set
        unresolved_iso = [
            r for r in rows
            if r["link_type"] == "wikilink" and ISO_DATE_RE.match(r["link_text"]) and not r["target_id"]
        ]
        if unresolved_iso:
            print(f"  FAIL source {source_id}: ISO-date wikilinks still dangling: {[r['link_text'] for r in unresolved_iso]}")

    print("\nDone.")


def check(name, before_val, after_val, same=False, expected_after=None):
    if same:
        status = "OK" if before_val == after_val else "FAIL"
        print(f"  [{status}] {name}: before={before_val}, after={after_val}")
    elif expected_after is not None:
        status = "OK" if after_val == expected_after else "FAIL"
        print(f"  [{status}] {name}: before={before_val}, after={after_val} (expected {expected_after})")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--preflight", action="store_true")
    ap.add_argument("--snapshot", metavar="FILE")
    ap.add_argument("--verify", metavar="BEFORE_FILE")
    args = ap.parse_args()

    if args.preflight:
        issues = preflight()
        sys.exit(1 if issues else 0)

    if args.snapshot:
        snap = snapshot()
        with open(args.snapshot, "w") as f:
            json.dump(snap, f, indent=2)
        print(f"Snapshot written to {args.snapshot}")
        print("\nCounts:")
        for k, v in snap["counts"].items():
            print(f"  {k}: {v}")
        return

    if args.verify:
        verify(args.verify)
        return

    ap.print_help()


if __name__ == "__main__":
    main()
