---
phase: 02-mcp-server
plan: "03"
subsystem: api
tags: [embeddings, openrouter, openai, ollama, anthropic, provider-pattern]

requires:
  - phase: 02-mcp-server/02-01
    provides: MCP project scaffold with test harness and vitest config
provides:
  - EmbeddingProvider interface contract (embed + dimensions)
  - createEmbeddingProvider factory for env-driven provider selection
  - Four concrete adapters (OpenRouter, OpenAI, Ollama, Anthropic-stub)
affects: [02-04, 02-05, 02-06]

tech-stack:
  added: []
  patterns: [provider-factory-pattern, env-driven-selection, structured-error-prefix]

key-files:
  created:
    - mcp/src/providers/interface.ts
    - mcp/src/providers/openrouter.ts
    - mcp/src/providers/openai.ts
    - mcp/src/providers/ollama.ts
    - mcp/src/providers/anthropic.ts
  modified:
    - mcp/tests/providers/factory.test.ts
    - mcp/tests/providers/interface.test.ts

key-decisions:
  - "Anthropic provider is a runtime stub that throws EMBEDDING_FAILED, not a compile-time exclusion"
  - "Ollama defaults to 768 dimensions (nomic-embed-text), cloud providers default to 1536"

patterns-established:
  - "Provider factory pattern: tool handlers import only createEmbeddingProvider, never provider classes"
  - "EMBEDDING_FAILED prefix on all provider errors for structured error handling"

requirements-completed: [MCP-05, MCP-06]

duration: 2min
completed: 2026-03-27
---

# Phase 2 Plan 3: Embedding Provider Layer Summary

**Provider-agnostic embedding layer with four adapters (OpenRouter, OpenAI, Ollama, Anthropic-stub) selectable via EMBEDDING_PROVIDER env var**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-27T22:52:00Z
- **Completed:** 2026-03-27T22:54:00Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- EmbeddingProvider interface defining embed() and dimensions contract
- Factory function selecting correct adapter from EMBEDDING_PROVIDER env var
- Four concrete adapters with HTTP fetch implementations
- 9 passing tests covering factory selection and interface contract

## Task Commits

Each task was committed atomically:

1. **Task 1: Define EmbeddingProvider interface and factory (RED)** - `a2a4ae2` (test)
2. **Task 1: Define EmbeddingProvider interface and factory (GREEN)** - `8d88b95` (feat)

_Note: Task 2 (four adapters) was implemented as part of Task 1 GREEN since the factory requires all providers to exist._

## Files Created/Modified
- `mcp/src/providers/interface.ts` - EmbeddingProvider interface and createEmbeddingProvider factory
- `mcp/src/providers/openrouter.ts` - OpenRouter embeddings adapter (default provider)
- `mcp/src/providers/openai.ts` - OpenAI direct embeddings adapter
- `mcp/src/providers/ollama.ts` - Ollama local embeddings adapter (768 default dimensions)
- `mcp/src/providers/anthropic.ts` - Anthropic stub with NOT_VERIFIED comment
- `mcp/tests/providers/factory.test.ts` - Factory selection tests (7 cases)
- `mcp/tests/providers/interface.test.ts` - Interface contract tests (2 cases)

## Decisions Made
- Anthropic provider implemented as runtime stub (throws EMBEDDING_FAILED) rather than compile-time exclusion, keeping the factory switch clean
- Ollama defaults to 768 dimensions matching nomic-embed-text; cloud providers default to 1536

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Embedding provider layer ready for tool handlers (insert, search, update) in plans 02-04 through 02-06
- Tool handlers should import only createEmbeddingProvider from interface.ts

---
*Phase: 02-mcp-server*
*Completed: 2026-03-27*
