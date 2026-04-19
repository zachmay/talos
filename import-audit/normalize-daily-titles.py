#!/usr/bin/env python3
"""Normalize daily-note titles to ISO format.

Two changes to the Obsidian vault:
  1. Daily notes (under Periodic Notes/Daily/) with non-ISO frontmatter
     titles — rewrite the `title:` line to the ISO date derived from the
     filename.
  2. All .md files — rewrite `[[Month D, YYYY]]` / `[[Month Dth, YYYY]]`
     wikilinks to `[[YYYY-MM-DD]]` in content.

Usage:
  normalize-daily-titles.py --dry-run
      Show what would change without writing.
  normalize-daily-titles.py
      Apply changes.

Afterwards, run sync-import.py to propagate to the DB.
"""

import argparse
import re
import sys
from pathlib import Path

VAULT = Path.home() / "Documents" / "Exocortex"
DAILY_DIR = VAULT / "Periodic Notes" / "Daily"

MONTH_NAMES = "January|February|March|April|May|June|July|August|September|October|November|December"
MONTHS = {m: i + 1 for i, m in enumerate(MONTH_NAMES.split("|"))}

# Wikilink date variants: [[Month D, YYYY]] or [[Month Dth, YYYY]]
WIKILINK_DATE_RE = re.compile(
    rf"\[\[({MONTH_NAMES}) (\d+)(?:st|nd|rd|th)?,? (\d{{4}})\]\]"
)

# Frontmatter title line: `title: "..."` or `title: ...`
TITLE_LINE_RE = re.compile(r'^(\s*title:\s*)(["\']?)([^"\'\n]*)\2\s*$', re.MULTILINE)

# ISO filename pattern
ISO_FILENAME_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})\.md$")

# Dirs to skip when scanning for Category 2 wikilinks.
# Roam is excluded for symmetry with sync-import.py (frozen archive — not
# resynced, so modifying the vault files would leave the DB out of sync).
SKIP_DIRS = {".obsidian", ".trash", ".claude", ".git", "node_modules",
             "social-chatter-2026-02-06-15-52-55",
             "Roam"}
SKIP_FILES = {"CLAUDE.md", "AGENTS.md"}


def prose_to_iso(month_name, day_str, year_str):
    """Convert ('September', '9', '2020') → '2020-09-09'."""
    month = MONTHS[month_name]
    day = int(day_str)
    year = int(year_str)
    return f"{year:04d}-{month:02d}-{day:02d}"


def normalize_daily_frontmatter(dry_run=False):
    """Pass 1: rewrite daily frontmatter titles to ISO."""
    changes = []  # (path, old_title, new_title)

    for path in sorted(DAILY_DIR.glob("*.md")):
        m = ISO_FILENAME_RE.match(path.name)
        if not m:
            continue
        iso = m.group(1)

        text = path.read_text(encoding="utf-8")

        # Only operate on frontmatter block
        if not text.startswith("---"):
            continue
        end = text.find("---", 3)
        if end == -1:
            continue

        frontmatter = text[3:end]
        rest = text[end:]

        title_match = TITLE_LINE_RE.search(frontmatter)
        if not title_match:
            continue

        current_title = title_match.group(3)
        if current_title == iso:
            continue  # already normalized

        # Replace title line preserving indent + quoting style
        new_line = f'{title_match.group(1)}"{iso}"'
        new_frontmatter = TITLE_LINE_RE.sub(new_line, frontmatter, count=1)
        new_text = "---" + new_frontmatter + rest

        changes.append((path, current_title, iso))

        if not dry_run:
            path.write_text(new_text, encoding="utf-8")

    return changes


def normalize_wikilinks(dry_run=False):
    """Pass 2: rewrite prose-date wikilinks in ALL vault files."""
    changes = []  # (path, old_text, new_text, count)

    for path in VAULT.rglob("*.md"):
        parts = path.relative_to(VAULT).parts
        if any(p in SKIP_DIRS for p in parts):
            continue
        if path.name in SKIP_FILES:
            continue

        try:
            text = path.read_text(encoding="utf-8")
        except Exception:
            continue

        if not WIKILINK_DATE_RE.search(text):
            continue

        occurrences = []
        def replacer(match):
            iso = prose_to_iso(match.group(1), match.group(2), match.group(3))
            occurrences.append((match.group(0), f"[[{iso}]]"))
            return f"[[{iso}]]"

        new_text = WIKILINK_DATE_RE.sub(replacer, text)

        if new_text != text:
            changes.append((path, occurrences))
            if not dry_run:
                path.write_text(new_text, encoding="utf-8")

    return changes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true",
                    help="Show proposed changes without modifying files")
    args = ap.parse_args()

    print(f"Vault: {VAULT}")
    print(f"Mode:  {'DRY RUN' if args.dry_run else 'APPLY'}")
    print()

    # Pass 1: Daily frontmatter
    print("=== Pass 1: Daily note frontmatter titles → ISO ===")
    cat1 = normalize_daily_frontmatter(dry_run=args.dry_run)
    print(f"  {len(cat1)} daily notes to update")
    for path, old, new in cat1[:10]:
        rel = path.relative_to(VAULT)
        print(f"    {rel}  '{old}' → '{new}'")
    if len(cat1) > 10:
        print(f"    ... and {len(cat1) - 10} more")

    # Pass 2: Wikilinks
    print("\n=== Pass 2: Prose-date wikilinks → ISO ===")
    cat2 = normalize_wikilinks(dry_run=args.dry_run)
    print(f"  {len(cat2)} files with wikilink rewrites")
    total_rewrites = sum(len(occ) for _, occ in cat2)
    print(f"  {total_rewrites} total wikilink occurrences rewritten")
    for path, occurrences in cat2[:10]:
        rel = path.relative_to(VAULT)
        print(f"    {rel}")
        for old, new in occurrences[:3]:
            print(f"      {old} → {new}")
        if len(occurrences) > 3:
            print(f"      ... and {len(occurrences) - 3} more in this file")
    if len(cat2) > 10:
        print(f"    ... and {len(cat2) - 10} more files")

    print("\nSummary:")
    print(f"  Daily frontmatter titles updated: {len(cat1)}")
    print(f"  Files with wikilink rewrites:     {len(cat2)}")
    print(f"  Wikilink occurrences rewritten:   {total_rewrites}")

    if args.dry_run:
        print("\n[dry-run] no files modified")
    else:
        print("\nNext step: run sync-import.py to propagate to the DB")


if __name__ == "__main__":
    main()
