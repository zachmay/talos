#!/usr/bin/env python3
"""Build import manifest for the ENTIRE Obsidian vault → Talos database.

Roam entries are already handled by roam-manifest.json / build-manifest.py.
This script handles everything else: Data/, Writing/, Projects/, Work/,
Periodic Notes/, Studio/, and System/ (cherry-picked).
"""

import json
import re
from pathlib import Path
from datetime import datetime

VAULT = Path.home() / "Documents" / "Exocortex"
AUDIT = Path(__file__).parent

# Directories to skip entirely
SKIP_DIRS = {
    ".obsidian", ".trash", ".claude", ".git",
    "node_modules", "scripts",
    "social-chatter-2026-02-06-15-52-55",  # duplicate Roam export
    "Video Games",  # empty
    "Music",  # empty
}

# Files to skip
SKIP_FILES = {"CLAUDE.md", "AGENTS.md"}


def parse_frontmatter(text):
    """Extract YAML frontmatter (simple key: value parser, handles multi-line arrays)."""
    if not text.startswith("---"):
        return {}, text
    end = text.find("---", 3)
    if end == -1:
        return {}, text
    fm_text = text[3:end].strip()
    content = text[end + 3:].strip()
    result = {}
    current_key = None
    current_list = None
    for line in fm_text.splitlines():
        # List item
        if line.strip().startswith("- ") and current_key:
            if current_list is None:
                current_list = []
            current_list.append(line.strip()[2:].strip().strip('"').strip("'"))
            continue
        # Save pending list
        if current_list is not None and current_key:
            result[current_key] = current_list
            current_list = None
            current_key = None
        # Key: value
        if ":" in line and not line.startswith(" "):
            key, _, val = line.partition(":")
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if val:
                result[key] = val
                current_key = None
            else:
                current_key = key  # might be a list
    # Save final pending list
    if current_list is not None and current_key:
        result[current_key] = current_list
    return result, content


def get_file_dates(path):
    stat = path.stat()
    created = datetime.fromtimestamp(stat.st_birthtime).strftime("%Y-%m-%d %H:%M:%S")
    updated = datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S")
    return created, updated


def vault_rel(path):
    """Get vault-relative path with leading /."""
    return "/" + str(path.relative_to(VAULT))


def route_file(rel_parts, filename):
    """Determine DB path from vault-relative directory parts.

    Returns (db_path, entry_type) or None to skip.
    """
    stem = filename.replace(".md", "")

    # --- Roam/ --- already handled by roam-manifest.json
    if rel_parts[0] == "Roam":
        return None

    # --- Inbox/ --- skip (empty or transient)
    if rel_parts[0] == "Inbox":
        return None

    # --- Data/ ---
    if rel_parts[0] == "Data":
        if len(rel_parts) < 2:
            return None
        sub = rel_parts[1]
        mapping = {
            "Films": (["data", "films"], "reference"),
            "Books": (["data", "books"], "reference"),
            "People": (["data", "people"], "reference"),
            "Relationships": (["data", "relationships"], "reference"),
            "Recipes": (["data", "recipes"], "reference"),
            "Businesses": (["data", "businesses"], "reference"),
            "Software": (["data", "software"], "reference"),
            "Habits": (["data", "habits"], "reference"),
            "Television": (["data", "television"], "reference"),
            "Games": (["data", "games"], "reference"),
            "Cleanup": (["concepts"], "concept"),
        }
        if sub == "Gear":
            # All gear is Eurorack per plan
            return (["data", "gear", "eurorack"], "reference")
        if sub in mapping:
            return mapping[sub]
        return None

    # --- Periodic Notes/ ---
    if rel_parts[0] == "Periodic Notes":
        if len(rel_parts) < 2:
            return None
        sub = rel_parts[1]
        if sub == "Daily":
            return (["periodic-notes", "daily"], "log")
        if sub == "Weekly":
            return (["periodic-notes", "weekly"], "log")
        return None

    # --- Work/ --- preserve subfolder structure
    if rel_parts[0] == "Work":
        db_path = ["work"] + [p.lower() for p in rel_parts[1:]]
        return (db_path, "reference")

    # --- Writing/ ---
    if rel_parts[0] == "Writing":
        if len(rel_parts) >= 2 and rel_parts[1] == "Ziusudra":
            # Preserve subfolder structure, skip .claude
            sub_parts = [p.lower() for p in rel_parts[1:]]
            return (["writing"] + sub_parts, "reference")
        # Loose writing files
        if len(rel_parts) == 1:
            # Check if it's the misfiled book
            if stem == "Production Haskell (2023)":
                return (["data", "books"], "reference")
            return (["writing", "unfiled"], "reference")
        return (["writing"] + [p.lower() for p in rel_parts[1:]], "reference")

    # --- Projects/ --- preserve subfolder structure
    if rel_parts[0] == "Projects":
        sub_parts = [p.lower().replace(" ", "-") for p in rel_parts[1:]]
        db_path = ["projects"] + sub_parts
        return (db_path, "reference")

    # --- Studio/ --- preserve subfolder structure
    if rel_parts[0] == "Studio":
        sub_parts = [p.lower() for p in rel_parts[1:]]
        return (["studio"] + sub_parts, "reference")

    # --- System/ --- cherry-pick (handled in pass 3, skip for now)
    if rel_parts[0] == "System":
        return None

    # Top-level loose files
    return None


def build_manifest():
    manifest = []
    skipped = 0
    roam_skipped = 0

    for path in sorted(VAULT.rglob("*.md")):
        # Skip excluded dirs
        rel = path.relative_to(VAULT)
        parts = rel.parts
        if any(p in SKIP_DIRS for p in parts):
            skipped += 1
            continue
        if path.name in SKIP_FILES:
            skipped += 1
            continue

        # Get directory parts (everything except filename)
        dir_parts = parts[:-1] if len(parts) > 1 else (parts[0].replace(".md", ""),)
        # For top-level files, dir_parts is empty
        if len(parts) == 1:
            dir_parts = ()

        # Route
        if not dir_parts:
            # Top-level vault files — skip (AGENTS.md, CLAUDE.md already filtered)
            skipped += 1
            continue

        route = route_file(list(dir_parts), path.name)
        if route is None:
            if dir_parts[0] == "Roam":
                roam_skipped += 1
            else:
                skipped += 1
            continue

        db_path, entry_type = route

        # Read file
        try:
            text = path.read_text(encoding="utf-8")
        except Exception:
            text = ""

        fm, content = parse_frontmatter(text)
        file_created, file_updated = get_file_dates(path)

        # Use frontmatter dates if available
        created = str(fm.get("created", file_created))
        updated = str(fm.get("updated", file_updated))

        # Title: from frontmatter, or filename stem
        title = fm.get("title", path.stem)

        # Stub detection
        is_stub = not content or not content.strip()

        # Build user metadata (provenance nested under _import)
        meta = {
            "_import": {
                "source": "obsidian",
                "original": vault_rel(path),
            },
            "created": created,
            "updated": updated,
        }

        # Preserve arbitrary frontmatter fields as user metadata.
        # No key collision issues now — title/type/source are all top-level columns.
        skip_fm_keys = {"title", "type", "created", "updated"}
        for k, v in fm.items():
            if k not in skip_fm_keys:
                meta[k] = v

        entry = {
            "title": title,
            "type": entry_type,
            "mime_type": "text/markdown",
            "path": db_path,
            "content": content if not is_stub else "",
            "is_stub": is_stub,
            "metadata": meta,
        }
        manifest.append(entry)

    return manifest, skipped, roam_skipped


def main():
    manifest, skipped, roam_skipped = build_manifest()

    # Summary by destination
    from collections import Counter
    dest_counts = Counter("/".join(e["path"]) for e in manifest)

    print(f"Total entries in manifest: {len(manifest)}")
    print(f"Skipped (non-content/system): {skipped}")
    print(f"Skipped (Roam, handled separately): {roam_skipped}")
    print(f"\nBy destination:")
    for dest, count in sorted(dest_counts.items(), key=lambda x: -x[1]):
        print(f"  /{dest}: {count}")

    # Compare against plan totals
    print("\n--- Plan Reconciliation ---")
    plan = {
        "data/films": 726,
        "data/people": 288,
        "data/books": 261,
        "data/gear/eurorack": 64,
        "data/relationships": 53,
        "data/recipes": 16,
        "data/software": 6,
        "data/habits": 5,
        "data/businesses": 3,
        "data/television": 1,
        "data/games": 1,
        "concepts": 98,  # Data/Cleanup
        "periodic-notes/daily": 1456,
        "periodic-notes/weekly": 4,
        "work": 164,  # total across subfolders
        "writing/ziusudra": 81,
        "writing/unfiled": 23,  # loose Writing/ files (minus Production Haskell)
        "projects": 134,  # total across subfolders (vault Projects/)
        "studio": 1,
    }

    for dest, expected in sorted(plan.items()):
        # Sum all sub-paths
        actual = sum(c for d, c in dest_counts.items() if d == dest or d.startswith(dest + "/"))
        status = "OK" if actual == expected else f"DIFF (expected {expected})"
        print(f"  /{dest}: {actual} {status}")

    # Write manifest
    out = AUDIT / "full-manifest.json"
    with open(out, "w") as f:
        json.dump(manifest, f, indent=2, default=str)
    print(f"\nManifest written to {out}")


if __name__ == "__main__":
    main()
