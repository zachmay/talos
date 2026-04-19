#!/usr/bin/env python3
"""Audit imported entries against source Obsidian vault files.

Uses direct DB queries via docker exec instead of MCP, for speed and
because the search tool doesn't apply filters in path-only mode.
"""

import json
import subprocess
import sys
from pathlib import Path

VAULT = Path.home() / "Documents" / "Exocortex"
AUDIT = Path(__file__).parent

# Structural metadata keys added during import (not from frontmatter)
STRUCTURAL_KEYS = {"type", "title", "source", "original-source", "subtype"}

# Dirs to skip entirely
SKIP_DIRS = {
    ".obsidian", ".trash", ".claude", ".git",
    "node_modules", "scripts",
    "social-chatter-2026-02-06-15-52-55",
    "Video Games", "Music",
}

SKIP_FILES = {"CLAUDE.md", "AGENTS.md"}


def psql(sql):
    """Run a SQL query via docker, return parsed JSON lines."""
    wrapped = f"SET app.agent_id = 'default-agent'; {sql}"
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


def fetch_all_obsidian():
    """Return {original_source: [entry_dict, ...]} for all obsidian entries."""
    sql = (
        "SELECT json_build_object("
        "'id', id, "
        "'original_source', metadata->'_import'->>'original', "
        "'title', title, "
        "'path', path, "
        "'metadata', metadata) "
        "FROM entries WHERE metadata->'_import'->>'source' = 'obsidian';"
    )
    entries = psql(sql)
    by_source = {}
    for e in entries:
        src = e.get("original_source")
        if src:
            by_source.setdefault(src, []).append(e)
    return entries, by_source


def parse_frontmatter(text):
    """Simple YAML frontmatter parser."""
    if not text.startswith("---"):
        return {}
    end = text.find("---", 3)
    if end == -1:
        return {}
    result = {}
    current_key = None
    current_list = None
    for line in text[3:end].strip().splitlines():
        if line.strip().startswith("- ") and current_key:
            if current_list is None:
                current_list = []
            current_list.append(line.strip()[2:].strip().strip('"').strip("'"))
            continue
        if current_list is not None and current_key:
            result[current_key] = current_list
            current_list = None
            current_key = None
        if ":" in line and not line.startswith(" "):
            key, _, val = line.partition(":")
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if val:
                result[key] = val
                current_key = None
            else:
                current_key = key
    if current_list is not None and current_key:
        result[current_key] = current_list
    return result


def compare_metadata(frontmatter, db_metadata):
    mismatches = []
    for key, expected in frontmatter.items():
        if key in STRUCTURAL_KEYS:
            continue
        actual = db_metadata.get(key)
        if actual is None:
            mismatches.append((key, str(expected), "<missing>"))
        elif str(actual) != str(expected):
            mismatches.append((key, str(expected), str(actual)))
    return mismatches


def forward_audit(by_source):
    """Walk vault → check each file has a DB entry with matching metadata."""
    total = 0
    found = 0
    missing_files = []
    mismatch_files = []
    metadata_ok = 0
    skipped = 0

    for path in sorted(VAULT.rglob("*.md")):
        parts = path.relative_to(VAULT).parts
        if any(p in SKIP_DIRS for p in parts):
            continue
        if path.name in SKIP_FILES:
            skipped += 1
            continue

        total += 1
        rel = "/" + str(path.relative_to(VAULT))
        entries = by_source.get(rel, [])

        if not entries:
            missing_files.append(rel)
            continue

        found += 1
        # Compare metadata
        try:
            text = path.read_text(encoding="utf-8")
        except:
            continue

        fm = parse_frontmatter(text)
        if fm:
            db_meta = entries[0].get("metadata", {})
            mismatches = compare_metadata(fm, db_meta)
            if mismatches:
                mismatch_files.append((rel, mismatches))
            else:
                metadata_ok += 1
        else:
            metadata_ok += 1

        if total % 500 == 0:
            print(f"  [{total}] found={found} missing={len(missing_files)} mismatches={len(mismatch_files)}")

    return {
        "total": total,
        "skipped": skipped,
        "found": found,
        "missing": len(missing_files),
        "missing_files": missing_files,
        "metadata_ok": metadata_ok,
        "metadata_mismatch": len(mismatch_files),
        "mismatch_files": mismatch_files,
    }


def reverse_audit(entries):
    """Check each DB entry has a corresponding vault file."""
    orphans = []
    no_source = []
    valid = 0

    for e in entries:
        orig = e.get("original_source")
        if not orig:
            no_source.append(e)
            continue
        vault_path = VAULT / orig.lstrip("/")
        if not vault_path.exists():
            orphans.append(e)
        else:
            valid += 1

    return {
        "total": len(entries),
        "valid": valid,
        "orphans": orphans,
        "no_source": no_source,
    }


def main():
    print("Fetching all obsidian-sourced entries from DB...")
    entries, by_source = fetch_all_obsidian()
    print(f"Found {len(entries)} DB entries across {len(by_source)} unique sources")

    if len(sys.argv) > 1 and sys.argv[1] == "--reverse-only":
        rev = reverse_audit(entries)
        print_reverse(rev)
        return

    print("\n" + "=" * 60)
    print("FORWARD AUDIT (vault → DB)")
    print("=" * 60)
    fwd = forward_audit(by_source)
    print_forward(fwd)

    print("\n" + "=" * 60)
    print("REVERSE AUDIT (DB → vault)")
    print("=" * 60)
    rev = reverse_audit(entries)
    print_reverse(rev)

    # Write report
    report = {
        "forward": {
            "total": fwd["total"],
            "found": fwd["found"],
            "missing": fwd["missing"],
            "metadata_ok": fwd["metadata_ok"],
            "metadata_mismatch": fwd["metadata_mismatch"],
            "missing_files": fwd["missing_files"],
            "mismatch_files": fwd["mismatch_files"],
        },
        "reverse": {
            "total": rev["total"],
            "valid": rev["valid"],
            "orphans": [
                {"id": o["id"], "title": o["title"], "original_source": o["original_source"]}
                for o in rev["orphans"]
            ],
            "no_source": [{"id": o["id"], "title": o["title"]} for o in rev["no_source"]],
        },
    }
    out = AUDIT / "audit-report.json"
    with open(out, "w") as f:
        json.dump(report, f, indent=2)
    print(f"\nFull report written to {out}")


def print_forward(f):
    print(f"Total vault files scanned: {f['total']}")
    print(f"Skipped (non-content):     {f['skipped']}")
    print(f"Found in DB:               {f['found']}")
    print(f"Missing from DB:           {f['missing']}")
    print(f"Metadata OK:               {f['metadata_ok']}")
    print(f"Metadata mismatches:       {f['metadata_mismatch']}")

    if f["missing_files"]:
        print(f"\n--- MISSING ({len(f['missing_files'])}) ---")
        for path in f["missing_files"][:30]:
            print(f"  {path}")
        if len(f["missing_files"]) > 30:
            print(f"  ... and {len(f['missing_files']) - 30} more")

    if f["mismatch_files"]:
        print(f"\n--- METADATA MISMATCHES ({len(f['mismatch_files'])}) ---")
        for path, mismatches in f["mismatch_files"][:10]:
            print(f"  {path}")
            for key, expected, actual in mismatches:
                print(f"    {key}: expected={expected!r} actual={actual!r}")
        if len(f["mismatch_files"]) > 10:
            print(f"  ... and {len(f['mismatch_files']) - 10} more")


def print_reverse(r):
    print(f"DB entries with source=obsidian: {r['total']}")
    print(f"Valid (file exists):             {r['valid']}")
    print(f"Orphans (file missing):          {len(r['orphans'])}")
    print(f"Missing original-source:         {len(r['no_source'])}")

    if r["orphans"]:
        print(f"\n--- ORPHANS ({len(r['orphans'])}) ---")
        for o in r["orphans"][:30]:
            print(f"  id={o['id']} title={o['title']!r} source={o['original_source']!r}")
        if len(r["orphans"]) > 30:
            print(f"  ... and {len(r['orphans']) - 30} more")


if __name__ == "__main__":
    main()
