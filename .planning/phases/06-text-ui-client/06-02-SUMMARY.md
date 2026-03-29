---
phase: 06-text-ui-client
plan: "02"
subsystem: agent
tags: [streaming, async-generator, anthropic-sdk, sse, backward-compat]

requires:
  - phase: 06-text-ui-client
    plan: "01"
    provides: "AgentEvent type contract in shared/types.ts"
  - phase: 03-agent-harness
    provides: "runClaudeLoop batch agentic loop"
provides:
  - "streamClaudeLoop AsyncGenerator yielding AgentEvent objects"
  - "Backward-compatible runClaudeLoop wrapper consuming the generator"
  - "startAgentLoop onEvent callback parameter for HTTP streaming"
affects: [06-text-ui-client, 07-subagent-capability]

tech-stack:
  added: []
  patterns: [async-generator-streaming, event-callback-injection]

key-files:
  created:
    - agent/src/__tests__/claude-stream.test.ts
  modified:
    - agent/src/providers/claude.ts
    - agent/src/agent.ts
    - agent/tsconfig.json

key-decisions:
  - "Widened agent tsconfig rootDir to '..' to support shared/types.ts imports across packages"
  - "streamClaudeLoop uses SDK .stream() with for-await iteration + finalMessage() for usage stats"
  - "onEvent callback pattern chosen over returning generator from startAgentLoop for simpler HTTP integration"

patterns-established:
  - "AsyncGenerator for streaming agent events: yield per token/thinking/tool, done at end"
  - "Backward-compat wrapper: consume generator, collect result, throw on error"

requirements-completed: [TUI-03]

duration: 6min
completed: 2026-03-28
---

# Phase 6 Plan 02: Streaming Provider Refactor Summary

**streamClaudeLoop AsyncGenerator yielding AgentEvent objects (token, thinking, tool_start, tool_result, done, error) with backward-compatible runClaudeLoop wrapper and onEvent callback in startAgentLoop**

## Performance

- **Duration:** 6 min
- **Tasks:** 2/2 completed
- **Tests:** 6 new (17 total passing)

## Task Summary

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | streamClaudeLoop AsyncGenerator + tests | b4114d2, 237091b | claude.ts, claude-stream.test.ts, tsconfig.json |
| 2 | Thread streaming through agent.ts | 540ce5f | agent.ts |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed shared/types.ts import path resolution**
- **Found during:** Task 1
- **Issue:** agent tsconfig.json had rootDir: ./src which prevented importing ../../shared/types.js (outside rootDir)
- **Fix:** Changed rootDir to '..' and added ../shared/** to include array; adjusted import paths to ../../../shared/types.js
- **Files modified:** agent/tsconfig.json, agent/src/providers/claude.ts, agent/src/__tests__/claude-stream.test.ts
- **Commit:** 237091b

## Verification

- TypeScript compiles clean (tsc --noEmit exits 0)
- All 17 tests pass (6 new streaming tests + 11 existing)
- claude.ts exports streamClaudeLoop AsyncGenerator
- agent.ts startAgentLoop accepts optional onEvent callback
- Backward compatibility confirmed: entrypoint.ts calls startAgentLoop(systemPrompt, input, conversationHistory) unchanged
