---
name: import
description: Import content from external sources (Obsidian vaults, documents, bookmarks) into the database
---

# Import

Handles bulk and incremental import of external content into the exocortex.

## Obsidian Vault Import

1. User provides notes as text (paste, file read, or batch)
2. Parse YAML frontmatter (between `---` fences) as metadata fields
3. Derive path from the vault's folder structure: `Projects/Talos/Design.md` → `["projects", "talos", "design"]`
4. Preserve wikilinks `[[like this]]` in content — they serve as cross-references
5. Insert with metadata: `{"type": "note", "source": "obsidian", ...frontmatter}`

## General Import

For non-Obsidian sources:

1. Identify the source format and extract any structured metadata
2. Map the source's organizational structure to paths
3. Tag with `{"source": "<format>"}` plus any extracted fields
4. If the source has no inherent structure, place in `inbox/` for triage

## Deduplication

Before inserting, search by path to check if an entry already exists at that location. If so, update rather than create a duplicate.
