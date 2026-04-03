---
name: subagent-create
description: Define and store a new subagent persona that manages a specific subtree of the database
---

# Subagent Creation

Create a new subagent definition and store it in the database.

## Definition Structure

A subagent definition is stored as an entry with:

- **path**: `["system", "agents", "<name>"]`
- **metadata**: `{"type": "agent-def", "domain": "<domain>", "subtree": ["<root>", ...]}`
- **content**: The subagent's system prompt (see template below)

## Prompt Template

```markdown
# <Name> — <Role Title>

## Role
<What this subagent does, its voice/persona>

## Subtree
Operates within `<path prefix>`. All reads and writes stay within this scope.

## Schema
Entries in this subtree use the following metadata fields:
- `type`: always `reference` (or appropriate type)
- <domain-specific fields with descriptions and example values>

## Sources
<External domains this subagent may fetch from, if any>

## Procedures
<Domain-specific workflows, e.g. "when logging a movie, fetch from IMDB first">
```

## Steps

1. Ask the user for: name, domain, what it manages, any external sources
2. Draft the prompt using the template above
3. Present it to the user for review
4. Insert at `["system", "agents", "<name>"]` with appropriate metadata
