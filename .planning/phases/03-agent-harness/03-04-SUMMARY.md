---
phase: 03-agent-harness
plan: 04
subsystem: agent
tags: [mcp, fetch, agent-profile, skills, docker, conversation-history, context-compression]

requires:
  - phase: 03-02
    provides: Sandboxed agent Dockerfiles and compose service
  - phase: 03-03
    provides: Agent runtime with skill library and Claude provider
provides:
  - MCP fetch tool with domain allowlisting
  - Base-agent profile with AGENT.md and example skill
  - Agent secrets generation in setup.sh
  - Conversation history persistence with context window compression
  - Local MCP client integration (replacing MCP connector beta)
  - Build-time TypeScript compilation in Dockerfiles
affects: [04-operations, 05-privacy]

tech-stack:
  added: ["@modelcontextprotocol/sdk (Client, StdioClientTransport)"]
  patterns: [local-mcp-client, secrets-as-files, context-window-compression]

key-files:
  created:
    - mcp/src/tools/fetch.ts
    - agents/base-agent/AGENT.md
    - agents/base-agent/skills/example-skill/SKILL.md
    - agents/base-agent/skills/example-skill/run.js
    - agents/base-agent/package.json
  modified:
    - mcp/src/server.ts
    - scripts/setup.sh
    - agent/src/providers/claude.ts
    - agent/src/entrypoint.ts
    - agent/src/agent.ts
    - agent/src/skills.ts
    - agent/Dockerfile.base
    - agent/Dockerfile.claude
    - agent/Dockerfile.ollama
    - agent/Dockerfile.openrouter
    - docker-compose.yml
    - scripts/test-sandbox.sh

key-decisions:
  - "Removed executeSkill -- skills run directly via bash in container, no wrapper needed"
  - "Refactored Claude provider from MCP connector beta to local MCP client (StdioClientTransport)"
  - "Secrets injected as files, config as env vars -- clean separation"
  - "Context window compression at 80% usage to avoid hitting token limits"
  - "Dockerfiles compile TypeScript at build time, not runtime"

patterns-established:
  - "Local MCP client: agent spawns MCP server as child process via StdioClientTransport"
  - "Conversation history: full message array persisted across turns"
  - "Context compression: summarize history when context window exceeds 80%"

requirements-completed: [AGT-02, AGT-03]

duration: 15min
completed: 2026-03-28
---

# Phase 3 Plan 4: Agent Wiring Summary

**MCP fetch tool with domain allowlisting, base-agent profile, conversation history with context compression, and local MCP client integration**

## Performance

- **Duration:** ~15 min (across multiple sessions with checkpoint)
- **Started:** 2026-03-28
- **Completed:** 2026-03-28
- **Tasks:** 3 (2 auto + 1 checkpoint)
- **Files modified:** 17

## Accomplishments
- MCP fetch tool with domain allowlisting (ALLOWED_DOMAINS / ALLOW_ALL_DOMAINS)
- Base-agent profile with AGENT.md system prompt and working example-skill
- Setup.sh extended with agent_llm_key and agent_api_key secret generation
- Claude provider refactored to use local MCP client instead of MCP connector beta
- Conversation history persistence with context window compression at 80% usage
- Rich CLI prompt showing context %, model, and agent name
- Dockerfiles fixed to compile TypeScript at build time
- Sandbox test script improved with --no-deps and --entrypoint flags

## Task Commits

Each task was committed atomically:

1. **Task 1: MCP fetch tool and base-agent profile** - `62b98b2` (feat)
2. **Task 2: setup.sh agent secrets extension** - `02b9022` (feat)
3. **Task 3: Checkpoint approved + post-checkpoint refactoring** - `4200793` (fix)

## Files Created/Modified
- `mcp/src/tools/fetch.ts` - MCP fetch tool with domain allowlisting
- `mcp/src/server.ts` - Registers fetch tool
- `agents/base-agent/AGENT.md` - Base agent system prompt with {{SKILL_INDEX}}
- `agents/base-agent/skills/example-skill/SKILL.md` - Example skill metadata
- `agents/base-agent/skills/example-skill/run.js` - Executable example skill
- `agents/base-agent/package.json` - Agent profile package
- `scripts/setup.sh` - Agent secrets generation added
- `agent/src/providers/claude.ts` - Refactored to local MCP client with conversation history
- `agent/src/entrypoint.ts` - Updated entrypoint with /quit /exit commands
- `agent/src/agent.ts` - Agent loop with configurable max_tokens and model
- `agent/src/skills.ts` - Removed executeSkill (skills run via bash)
- `agent/Dockerfile.*` - Build-time TS compilation
- `docker-compose.yml` - ALLOWED_DOMAINS env vars added
- `scripts/test-sandbox.sh` - Fixed with --no-deps, --entrypoint

## Decisions Made
- Removed executeSkill wrapper -- skills are simple bash scripts, no abstraction needed
- Refactored from MCP connector beta API to local MCP client (StdioClientTransport) for stability
- Secrets as files, config as env vars -- follows Docker secrets best practice
- Context window compression at 80% to avoid hard token limit failures
- Build-time TS compilation avoids runtime compilation overhead and missing devDependencies

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Claude provider MCP integration**
- **Found during:** Post-checkpoint verification
- **Issue:** MCP connector beta API was unstable; provider needed local MCP client pattern
- **Fix:** Refactored to use @modelcontextprotocol/sdk Client with StdioClientTransport
- **Files modified:** agent/src/providers/claude.ts
- **Committed in:** 4200793

**2. [Rule 1 - Bug] Fixed Dockerfiles for build-time compilation**
- **Found during:** Post-checkpoint verification
- **Issue:** Dockerfiles didn't compile TypeScript, causing runtime failures
- **Fix:** Added tsc build step to all Dockerfiles
- **Files modified:** agent/Dockerfile.base, .claude, .ollama, .openrouter
- **Committed in:** 4200793

**3. [Rule 2 - Missing Critical] Added conversation history and context compression**
- **Found during:** Post-checkpoint testing
- **Issue:** Agent had no conversation memory; would lose context between turns
- **Fix:** Added message array persistence and 80% context window compression
- **Files modified:** agent/src/providers/claude.ts, agent/src/agent.ts
- **Committed in:** 4200793

**4. [Rule 3 - Blocking] Fixed sandbox test script**
- **Found during:** Post-checkpoint verification
- **Issue:** Test script tried to start dependencies and used wrong entrypoint
- **Fix:** Added --no-deps and --entrypoint flags
- **Files modified:** scripts/test-sandbox.sh
- **Committed in:** 4200793

---

**Total deviations:** 4 auto-fixed (2 bugs, 1 missing critical, 1 blocking)
**Impact on plan:** All fixes necessary for a working end-to-end agent. No scope creep.

## Issues Encountered
- MCP connector beta API proved unstable -- replaced with local MCP client pattern using StdioClientTransport

## User Setup Required
None - no external service configuration required beyond existing setup.sh flow.

## Next Phase Readiness
- Phase 3 complete: agent harness fully wired with sandbox, skills, MCP tools, and conversation persistence
- Ready for Phase 4: Operations (audit logging, backup/restore, CLI tooling)
- Agent can be started with `docker compose up` and interacted with via `docker compose attach agent`

---
*Phase: 03-agent-harness*
*Completed: 2026-03-28*
