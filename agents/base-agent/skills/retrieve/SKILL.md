---
name: retrieve
description: Search strategy for answering questions from database content
---

# Retrieval

Strategy for finding and synthesizing answers from the database.

## Search Strategy

1. Start with a semantic search at default threshold (0.7)
2. If results are sparse or empty, broaden to 0.3–0.5
3. If the query implies a specific domain, add a path prefix filter
4. Use metadata filters when the user specifies structured criteria (e.g. "movies rated above 8")

## Answering

- Synthesize from search results; cite entry paths so the user can find the source
- If nothing is found, say so explicitly — do not fill gaps with training knowledge unless the user asks for general knowledge
- When multiple entries are relevant, prefer the most specific match

## Browse Mode

When the user wants to explore rather than search:

- Use path-only queries (no search text) with depth limits to list subtrees
- Present results as a navigable outline
