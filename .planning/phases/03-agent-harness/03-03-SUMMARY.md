---
phase: 03-agent-harness
plan: 03
subsystem: agent
tags: [anthropic-sdk, mcp-connector, js-yaml, child-process, execFile, tdd]

requires:
  - phase: 03-agent-harness/03-01
    provides: "Wave 0 scaffolding (package.json, tsconfig, jest config, Dockerfile)"
provides:
  - "buildSkillIndex() - YAML frontmatter skill index builder"
  - "executeSkill() - secure child process skill executor with timeout"
  - "loadSystemPrompt() - AGENT.md loader with skill index injection"
  - "startAgentLoop() - provider-agnostic agentic loop dispatcher"
  - "runClaudeLoop() - Anthropic MCP connector beta agentic loop"
affects: [03-agent-harness/03-04, 04-integration]

tech-stack:
  added: [js-yaml, "@anthropic-ai/sdk MCP connector beta"]
  patterns: [TDD red-green, execFile for security, MCP connector beta mcp-client-2025-11-20]

key-files:
  created:
    - agent/src/skills.ts
    - agent/src/prompt.ts
    - agent/src/entrypoint.ts
    - agent/src/agent.ts
    - agent/src/providers/claude.ts
    - agent/src/__tests__/skills.test.ts
    - agent/src/__tests__/prompt.test.ts
  modified: []

key-decisions:
  - "Extracted loadSystemPrompt into prompt.ts (jest ESM VM modules cannot resolve entrypoint.js named exports)"
  - "executeSkill accepts optional skillsBaseDir and timeout params for testability"
  - "Claude provider uses Function cast for beta API to avoid strict type mismatch with mcp_servers field"

patterns-established:
  - "TDD: RED commit with failing stubs, GREEN commit with implementation"
  - "Skill execution via execFile (never exec) with configurable timeout"
  - "System prompt injection via {{SKILL_INDEX}} placeholder pattern"

requirements-completed: [AGT-02, AGT-03]

duration: 5min
completed: 2026-03-28
---

# Phase 3 Plan 3: Agent Runtime Summary

**Skill library (buildSkillIndex + executeSkill), system prompt injection, and Claude agentic loop with MCP connector beta (mcp-client-2025-11-20)**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-28T04:04:23Z
- **Completed:** 2026-03-28T04:12:00Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Implemented buildSkillIndex that parses YAML frontmatter from SKILL.md files and returns formatted skill index
- Implemented executeSkill using execFile (not exec) with 30s timeout and 512KB output cap
- Built entrypoint with AGENT.md loading, skill index injection, and stdin readline loop
- Created Claude provider with Anthropic MCP connector beta, 50-turn max guard, and HTTP URL warning

## Task Commits

Each task was committed atomically:

1. **Task 1: Skill library (RED)** - `0f541e8` (test)
2. **Task 1: Skill library (GREEN)** - `b185534` (feat)
3. **Task 2: Entrypoint/agent/claude (RED)** - `70dda26` (test)
4. **Task 2: Entrypoint/agent/claude (GREEN)** - `11fd6d6` (feat)

## Files Created/Modified
- `agent/src/skills.ts` - buildSkillIndex and executeSkill with YAML parsing and secure child process execution
- `agent/src/prompt.ts` - loadSystemPrompt reads AGENT.md, injects skill index at {{SKILL_INDEX}} placeholder
- `agent/src/entrypoint.ts` - Startup: loads AGENT.md, builds skill index, starts stdin readline loop
- `agent/src/agent.ts` - Provider-agnostic agentic loop dispatcher
- `agent/src/providers/claude.ts` - Anthropic SDK agentic loop with MCP connector beta (mcp-client-2025-11-20)
- `agent/src/__tests__/skills.test.ts` - 11 tests covering index building, execution, timeout, security
- `agent/src/__tests__/prompt.test.ts` - 4 tests covering prompt loading, injection, fallback

## Decisions Made
- Extracted loadSystemPrompt into prompt.ts instead of exporting from entrypoint.ts -- jest's experimental ESM VM modules fail to resolve named exports from a file named "entrypoint.js"
- executeSkill accepts optional skillsBaseDir (default /app/agent/skills) and timeout params for testability
- Used Function cast for anthropic.beta.messages.create to avoid strict type issues with mcp_servers beta field

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed missing ts-node dependency**
- **Found during:** Task 1 (RED phase)
- **Issue:** jest.config.ts requires ts-node to parse TypeScript config
- **Fix:** npm install --save-dev ts-node
- **Files modified:** package.json, package-lock.json
- **Verification:** Jest runs successfully
- **Committed in:** 0f541e8

**2. [Rule 3 - Blocking] Moved loadSystemPrompt to prompt.ts**
- **Found during:** Task 2 (RED phase)
- **Issue:** Jest ESM VM modules cannot resolve named exports from ../entrypoint.js
- **Fix:** Created separate prompt.ts module for the testable loadSystemPrompt function
- **Files modified:** agent/src/prompt.ts, agent/src/__tests__/prompt.test.ts
- **Verification:** All 4 entrypoint tests pass when importing from prompt.js
- **Committed in:** 70dda26

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both fixes necessary for test infrastructure to work. No scope creep.

## Issues Encountered
- Jest ESM experimental VM modules cannot resolve named exports from a module named "entrypoint.js" -- root cause unclear, possibly a jest/ts-jest bug with that filename. Workaround: separate module.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Agent runtime source complete, ready for Dockerfile integration and compose wiring (03-04)
- All 15 unit tests pass, TypeScript compiles clean
- Claude provider ready for runtime testing once MCP server is accessible

## Self-Check: PASSED

All 7 files verified present. All 4 commit hashes verified in git log.

---
*Phase: 03-agent-harness*
*Completed: 2026-03-28*
