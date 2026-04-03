---
name: triage
description: Review inbox entries and organize them into permanent locations with proper metadata
---

# Triage

Review and organize unsorted entries from `inbox/`.

## Procedure

1. List all entries under `inbox/` using a path-only search
2. For each entry, examine content and any existing metadata
3. Propose a permanent path and enriched metadata based on content analysis
4. Present the plan to the user for approval before moving
5. To move: insert at the new path with updated metadata, then delete the inbox entry

## Guidelines

- Group related inbox items and propose them together
- If an entry's destination is ambiguous, ask the user
- After triage, confirm the inbox is empty (or report what remains and why)
