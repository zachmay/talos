---
phase: 02-mcp-server
plan: "04"
subsystem: api
tags: [mcp, tools, insert, search, embeddings, semantic-search, tdd]

requires:
  - phase: 02-mcp-server/02-02
    provides: authMiddleware, withAgent, chunkText
  - phase: 02-mcp-server/02-03
    provides: createEmbeddingProvider, EmbeddingProvider interface
provides:
  - registerInsertTool (MCP insert with atomic entry+chunks write)
  - registerSearchTool (MCP search with semantic and path-listing modes)
  - _handleInsert and _handleSearch exported for unit testing
affects: [02-05, 02-06]

tech-stack:
  added: []
  patterns: [tool-handler-with-testable-export, toolError-structured-response, embed-before-write]

key-files:
  created:
    - mcp/src/tools/insert.ts
    - mcp/src/tools/search.ts
  modified:
    - mcp/tests/tools/insert.test.ts
    - mcp/tests/tools/search.test.ts

key-decisions:
  - "Exported _handleInsert/_handleSearch for direct unit testing alongside registerXTool for McpServer registration"
  - "Embedding failure in insert rejects before withAgent call, ensuring zero partial writes"
  - "Path-only search uses direct SQL query instead of match_entries to avoid unnecessary embedding"

patterns-established:
  - "Tool handlers export both register function (for McpServer) and _handle function (for unit tests)"
  - "toolError(code, message) returns structured MCP error with isError: true"
  - "Embed all chunks before DB transaction; reject entirely on any embedding failure"

requirements-completed: [MCP-01, MCP-02, MCP-06]

duration: 2min
completed: 2026-03-28
---

# Phase 02 Plan 04: Insert and Search Tool Handlers Summary

**Insert tool with atomic entry+chunks write via embedding provider, and search tool with semantic query, path-listing, and combined modes**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-28T02:56:00Z
- **Completed:** 2026-03-28T02:59:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Insert tool (MCP-01): validates content, embeds all chunks, writes entry + N chunks atomically via withAgent
- Search tool (MCP-02): three modes -- semantic query, path-only listing, combined path-scoped search
- Both tools support verbose mode for extended response fields
- 24 tests passing across both tool handlers

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Insert tool tests** - `fea5951` (test)
2. **Task 1 GREEN: Insert tool implementation** - `a819f1d` (feat)
3. **Task 2 RED: Search tool tests** - `3d7dfd3` (test)
4. **Task 2 GREEN: Search tool implementation** - `fab8c97` (feat)

## Files Created/Modified
- `mcp/src/tools/insert.ts` - registerInsertTool + _handleInsert: embed, chunk, write atomically
- `mcp/src/tools/search.ts` - registerSearchTool + _handleSearch: semantic search, path listing, combined
- `mcp/tests/tools/insert.test.ts` - 12 tests for insert tool (validation, atomicity, verbose, embedding failure)
- `mcp/tests/tools/search.test.ts` - 12 tests for search tool (semantic, path-only, combined, verbose, empty results)

## Decisions Made
- Exported _handleInsert/_handleSearch alongside register functions for direct unit testing without McpServer
- Embedding failures reject before withAgent() call, guaranteeing no partial DB writes
- Path-only search mode uses direct SQL (not match_entries) to avoid unnecessary embedding call

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Insert and search tools ready for integration with MCP server transport (02-05/02-06)
- 24 tests provide regression safety for tool handler behavior

---
*Phase: 02-mcp-server*
*Completed: 2026-03-28*
