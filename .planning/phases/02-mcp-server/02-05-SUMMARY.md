---
phase: 02-mcp-server
plan: "05"
subsystem: api
tags: [mcp, update, delete, re-embed, cascade, tdd]

requires:
  - phase: 02-02
    provides: withAgent transaction wrapper, chunkText
  - phase: 02-03
    provides: createEmbeddingProvider factory
provides:
  - registerUpdateTool (content re-embed + metadata-only update)
  - registerDeleteTool (cascade delete with NOT_FOUND detection)
affects: [02-06]

tech-stack:
  added: []
  patterns: [embed-before-transaction, rowCount-not-found-detection, toolError-pattern]

key-files:
  created:
    - mcp/src/tools/update.ts
    - mcp/src/tools/delete.ts
  modified:
    - mcp/tests/tools/update.test.ts
    - mcp/tests/tools/delete.test.ts

key-decisions:
  - "Embedding happens outside transaction to avoid holding DB locks during slow HTTP calls"
  - "NOT_FOUND detection via rowCount covers both missing entries and RLS-filtered unauthorized access"

requirements-completed: [MCP-03, MCP-04]
duration: 3min
completed: "2026-03-28"
---

# Phase 02 Plan 05: Update and Delete Tools Summary

**Update tool with content re-embedding and metadata-only paths, delete tool with CASCADE chunk removal and NOT_FOUND detection via rowCount**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-28T02:55:58Z
- **Completed:** 2026-03-28T02:58:58Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Update tool (MCP-03): full content replace with re-embed, metadata-only path skips embedding, verbose mode
- Delete tool (MCP-04): single DELETE with CASCADE for chunks, NOT_FOUND via rowCount
- Both tools use toolError() pattern for structured error responses
- Full TDD cycle: 12 tests across both tools

## Task Commits

1. **Task 1 RED: Update tool tests** - `2996ece` (test)
2. **Task 1 GREEN: Update tool implementation** - `d4addc1` (feat)
3. **Task 2 RED: Delete tool tests** - `38b5dec` (test)
4. **Task 2 GREEN: Delete tool implementation** - `c29f6c8` (feat)

## Files Created/Modified
- `mcp/src/tools/update.ts` - handleUpdate + registerUpdateTool, content re-embed and metadata-only paths
- `mcp/src/tools/delete.ts` - handleDelete + registerDeleteTool, CASCADE delete with NOT_FOUND
- `mcp/tests/tools/update.test.ts` - 8 tests: re-embed, metadata-only, NOT_FOUND, validation, rollback, verbose
- `mcp/tests/tools/delete.test.ts` - 4 tests: successful delete, NOT_FOUND, no content in response

## Decisions Made
- Embedding runs outside the transaction to avoid holding DB connections during slow HTTP calls to embedding providers
- NOT_FOUND detection uses rowCount === 0 which naturally covers both missing entries and RLS-filtered unauthorized access

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None

## Next Phase Readiness
- Full CRUD surface complete (insert from 02-04, update + delete from this plan)
- Ready for 02-06 server registration and transport wiring
