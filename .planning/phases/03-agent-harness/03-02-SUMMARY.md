---
phase: 03-agent-harness
plan: 02
subsystem: infra
tags: [docker, seccomp, sandbox, container, security]

requires:
  - phase: 03-01
    provides: "Agent npm project with TypeScript config and dependencies"
  - phase: 01-foundation
    provides: "Docker compose structure, networks, secrets"
provides:
  - "Sandboxed agent Dockerfiles (base + claude/openrouter/ollama)"
  - "Docker default seccomp profile for standard sandbox"
  - "Hardened agent compose service with full security options"
  - "Agent profile directory structure (agents/base-agent/)"
affects: [03-agent-harness, 04-profiles-skills]

tech-stack:
  added: [seccomp]
  patterns: [self-contained-dockerfiles, read-only-rootfs, non-root-container]

key-files:
  created:
    - agent/Dockerfile.base
    - agent/Dockerfile.claude
    - agent/Dockerfile.openrouter
    - agent/Dockerfile.ollama
    - agent/seccomp-standard.json
    - agent/src/entrypoint.js
    - agents/base-agent/.gitkeep
  modified:
    - docker-compose.yml

key-decisions:
  - "Self-contained provider Dockerfiles (no local image tag coupling)"
  - "deluser node before creating agent uid 1000 (Alpine conflict)"
  - "Docker default seccomp v28.0.1 as standard sandbox profile"

patterns-established:
  - "Self-contained Dockerfiles: each provider image duplicates base setup to avoid build-order dependencies"
  - "Agent profile directories: agents/{profile}/ mounted read-only at /app/agent/"

requirements-completed: [AGT-01, AGT-04]

duration: 4min
completed: 2026-03-28
---

# Phase 3 Plan 02: Sandboxed Agent Container Summary

**Hardened Docker images with read-only rootfs, dropped capabilities, seccomp, and non-root user for all three LLM provider variants**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-28T04:04:00Z
- **Completed:** 2026-03-28T04:08:00Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Built self-contained Dockerfiles for claude, openrouter, and ollama providers
- Applied full standard sandbox: read-only rootfs, cap_drop ALL, no-new-privileges, seccomp, non-root user
- Added hardened agent service to docker-compose.yml with resource limits and frontend-only networking
- Created strict gVisor profile as opt-in compose profile for Linux hosts

## Task Commits

1. **Task 1: Agent Dockerfiles** - `a277f98` (feat)
2. **Task 2: Seccomp profile and compose service** - `d934883` (feat)

## Files Created/Modified
- `agent/Dockerfile.base` - Base image with Node 22, non-root agent user, npm ci
- `agent/Dockerfile.claude` - Claude provider (self-contained, ENV AGENT_LLM_PROVIDER=claude)
- `agent/Dockerfile.openrouter` - OpenRouter provider variant
- `agent/Dockerfile.ollama` - Ollama provider variant
- `agent/seccomp-standard.json` - Docker default seccomp profile (v28.0.1, 832 lines)
- `agent/src/entrypoint.js` - Stub entrypoint for container lifecycle
- `agents/base-agent/.gitkeep` - Base agent profile directory
- `docker-compose.yml` - Agent service with full security config

## Decisions Made
- Self-contained provider Dockerfiles to avoid local image tag build-order coupling
- Removed existing `node` user (uid 1000) in Alpine before creating `agent` user at same UID
- Used Docker's official default seccomp profile (v28.0.1) rather than hand-rolling one

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed uid 1000 conflict in node:22-alpine**
- **Found during:** Task 1 (Dockerfile build)
- **Issue:** Alpine node image already has uid 1000 assigned to `node` user
- **Fix:** Added `deluser --remove-home node` before creating agent user
- **Files modified:** All four Dockerfiles
- **Verification:** `docker run --rm --entrypoint id talos-agent-test` outputs uid=1000(agent)
- **Committed in:** a277f98

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary fix for build to succeed. No scope creep.

## Issues Encountered
- GitHub raw content URL for moby/moby master branch returned 404; used tagged release v28.0.1 URL instead

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Agent container builds and runs with full standard sandbox isolation
- Ready for agent prompt/bootstrap (03-03) and skill library (03-04)
- agents/base-agent/ directory ready for AGENT.md and skills

---
*Phase: 03-agent-harness*
*Completed: 2026-03-28*
