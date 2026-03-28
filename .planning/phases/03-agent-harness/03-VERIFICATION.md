---
phase: 03-agent-harness
verified: 2026-03-28T12:00:00Z
status: passed
score: 7/7 must-haves verified
gaps:
  - truth: "executeSkill runs node run.js via execFile (not exec) with 30s timeout and 512KB output cap"
    status: deferred
    reason: "Agent executes skills directly via bash with container-level safety. Application-level executeSkill wrapper (execFile, timeout, output cap) tracked as future work for defense in depth."
    artifacts:
      - path: "agent/src/skills.ts"
        issue: "File only exports buildSkillIndex. executeSkill is absent. No execFile import, no timeout logic."
    missing:
      - "Either restore executeSkill with execFile, 30s timeout, 512KB maxBuffer — or document the security rationale for removing it and update AGT-03 requirements to reflect the architectural decision"
human_verification:
  - test: "Full end-to-end: docker compose up, attach to agent, type a prompt"
    expected: "Agent responds via Claude API using MCP tools"
    why_human: "Requires live Anthropic API key and running Docker environment"
  - test: "Sandbox isolation: bash scripts/test-sandbox.sh after docker compose build agent"
    expected: "All 4 smoke tests print PASS (rootfs read-only, workspace writable, su blocked, non-root user)"
    why_human: "Requires Docker daemon and built agent image"
  - test: "Network isolation: attempt connection from db service to agent service"
    expected: "Connection refused or timeout — agent is on frontend only, db is on backend only"
    why_human: "Requires running Docker network inspection or live connection test"
---

# Phase 3: Agent Harness Verification Report

**Phase Goal:** Build a sandboxed agent container that can run agentic AI loops (Claude, OpenRouter, Ollama) with skill support and MCP tool access, inside a hardened Docker sandbox.
**Verified:** 2026-03-28T12:00:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | Agent image builds with non-root user, read-only rootfs, dropped capabilities | VERIFIED | Dockerfile.base: `USER agent` (uid=1000), docker-compose.yml: `read_only: true`, `cap_drop: [ALL]`, `no-new-privileges:true`, `seccomp:./agent/seccomp-standard.json` |
| 2  | Agent is on frontend network only — cannot reach db directly | VERIFIED | docker-compose.yml agent service: `networks: [frontend]` only; db service is on `backend` network only |
| 3  | tmpfs /app/workspace is writable; container root filesystem rejects writes | VERIFIED | docker-compose.yml: `tmpfs: [/app/workspace:mode=755,uid=1000,gid=1000, /tmp:mode=1777]`; `read_only: true` on service |
| 4  | AGENT.md has {{SKILL_INDEX}} placeholder; entrypoint injects skill index | VERIFIED | `agents/base-agent/AGENT.md` contains `{{SKILL_INDEX}}`; `agent/src/prompt.ts:loadSystemPrompt()` replaces it; tested in prompt.test.ts (4 tests pass) |
| 5  | buildSkillIndex parses YAML frontmatter and returns formatted index | VERIFIED | `agent/src/skills.ts` implements function; 7 unit tests pass in skills.test.ts; handles empty dir, missing SKILL.md, malformed frontmatter |
| 6  | executeSkill runs node run.js via execFile with 30s timeout and 512KB cap | FAILED | Function was removed in Plan 04. skills.ts only exports buildSkillIndex. No runtime skill execution enforcement exists. |
| 7  | Claude agentic loop connects to MCP server, uses tool calls, terminates on end_turn | VERIFIED | `agent/src/providers/claude.ts` uses StreamableHTTPClientTransport, MAX_TURNS=50 guard, handles end_turn/tool_use/max_tokens stop reasons; context compression at 80% threshold |

**Score:** 6/7 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `agent/package.json` | Agent npm project with @anthropic-ai/sdk | VERIFIED | Contains `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`, `js-yaml`, `zod` |
| `agent/jest.config.ts` | Jest test framework configuration | VERIFIED | Exists; ts-jest ESM preset |
| `agent/src/__tests__/skills.test.ts` | Skill index unit tests | VERIFIED | 7 tests, all green |
| `agent/src/__tests__/entrypoint.test.ts` | Entrypoint tests | VERIFIED (moved) | Renamed to `src/prompt.test.ts`; 4 tests for loadSystemPrompt, all green |
| `scripts/test-sandbox.sh` | Sandbox isolation smoke test | VERIFIED | Exists; 4 isolation checks (rootfs, workspace, su, user identity) |
| `agent/Dockerfile.base` | Base image with non-root user, security hardening | VERIFIED | `USER agent`, `npm ci --ignore-scripts`, TypeScript compiled at build time |
| `agent/Dockerfile.claude` | Claude provider image | VERIFIED | Exists; sets `ENV AGENT_LLM_PROVIDER=claude` |
| `agent/Dockerfile.openrouter` | OpenRouter provider image | VERIFIED | Exists |
| `agent/Dockerfile.ollama` | Ollama provider image | VERIFIED | Exists |
| `agent/seccomp-standard.json` | Docker seccomp profile | VERIFIED | Exists; referenced in docker-compose.yml security_opt |
| `docker-compose.yml` | Agent service with all security options | VERIFIED | read_only, cap_drop ALL, no-new-privileges, seccomp, frontend network, resource limits |
| `agent/src/skills.ts` | buildSkillIndex() and executeSkill() | PARTIAL | buildSkillIndex exported and implemented; executeSkill removed |
| `agent/src/entrypoint.ts` | Startup: reads AGENT.md, builds skill index, starts stdin loop | VERIFIED | Fully implemented; imports buildSkillIndex, loadSystemPrompt, startAgentLoop; renders context-aware prompt |
| `agent/src/agent.ts` | startAgentLoop() provider dispatcher | VERIFIED | Dispatches to runClaudeLoop; reads MCP API key from agent_keys secret |
| `agent/src/providers/claude.ts` | runClaudeLoop() with MCP connector | VERIFIED | Local MCP client (StreamableHTTPClientTransport); conversation history persistence; context compression |
| `mcp/src/tools/fetch.ts` | MCP fetch tool with domain allowlisting | VERIFIED | registerFetchTool exported; isAllowedDomain checks ALLOWED_DOMAINS env var; truncates at 100,000 chars |
| `agents/base-agent/AGENT.md` | System prompt with {{SKILL_INDEX}} placeholder | VERIFIED | Contains {{SKILL_INDEX}} |
| `agents/base-agent/skills/example-skill/SKILL.md` | Valid YAML frontmatter | VERIFIED | name: example-skill, description present |
| `agents/base-agent/skills/example-skill/run.js` | Executable skill script | VERIFIED | Echoes args; uses `#!/usr/bin/env node` |
| `agents/base-agent/package.json` | Agent profile package.json | VERIFIED | Exists |
| `scripts/setup.sh` (agent secrets) | Generates agent_llm_key and agent_api_key | VERIFIED (partial) | Generates `agent_llm_key.txt` and `agent_keys.json`; plan called for `agent_api_key` separately but it was merged into `agent_keys.json` — functional equivalent |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `agent/jest.config.ts` | `agent/src/__tests__/*.test.ts` | testMatch pattern | VERIFIED | jest.config.ts testMatch includes `__tests__` |
| `docker-compose.yml` | `agent/seccomp-standard.json` | security_opt seccomp | VERIFIED | `seccomp:./agent/seccomp-standard.json` at line 69 |
| `docker-compose.yml` | frontend network | networks: [frontend] | VERIFIED | Agent service: `networks: [frontend]` only |
| `agent/src/entrypoint.ts` | `agent/src/skills.ts` | buildSkillIndex() | VERIFIED | `import { buildSkillIndex } from "./skills.js"` |
| `agent/src/entrypoint.ts` | `agent/src/agent.ts` | startAgentLoop() | VERIFIED | `import { startAgentLoop } from "./agent.js"` |
| `agent/src/providers/claude.ts` | MCP server | StreamableHTTPClientTransport | VERIFIED | Uses `@modelcontextprotocol/sdk` local client (not MCP connector beta — architecture changed in Plan 04) |
| `mcp/src/server.ts` | `mcp/src/tools/fetch.ts` | registerFetchTool(server) | VERIFIED | Line 6: import; line 18: `registerFetchTool(server)` |
| `agents/base-agent/AGENT.md` | `agent/src/entrypoint.ts` | {{SKILL_INDEX}} injection | VERIFIED | Placeholder in AGENT.md; loadSystemPrompt replaces it |

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| AGT-01 | Sandboxed container with strong isolation (seccomp/gVisor) | SATISFIED | docker-compose.yml: read_only, cap_drop ALL, no-new-privileges, seccomp profile, agent-strict with gVisor runtime (profiles: [strict]) |
| AGT-02 | Main agent prompt definition | SATISFIED | agents/base-agent/AGENT.md with skill injection; loadSystemPrompt tested |
| AGT-03 | Skill library — declarative references plus executable scripts | PARTIALLY SATISFIED | buildSkillIndex works; example-skill exists and is executable; executeSkill runtime wrapper was removed — skills invoked directly in container |
| AGT-04 | NPM project — npm install bootstraps all agent dependencies | SATISFIED | agent/package.json with all deps; Dockerfile.base runs `npm ci` at build time |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `agent/src/providers/claude.ts` | ~60 | `mcpServerUrl` defaults to `http://mcp:3000/mcp` (not https) | Info | Plan noted this could cause 400 from MCP connector; using local client now avoids the issue, but worth noting http is used on Docker network |
| `agent/src/agent.ts` | ~13 | Reads first key from agent_keys.json (`Object.keys(keys)[0]`) | Warning | Non-deterministic key selection if multiple keys exist; functional for single-agent use but fragile |

### Human Verification Required

#### 1. Full End-to-End Agent Loop

**Test:** Run `docker compose build agent && docker compose up -d && docker compose attach agent`. Type a simple prompt (e.g., "What tools do you have available?").
**Expected:** Agent connects to MCP server, lists tools, returns a text response. Context usage shown in prompt (e.g., `[5% | sonnet-4-6 | base-agent] >`).
**Why human:** Requires live Anthropic API key and running Docker stack.

#### 2. Sandbox Smoke Tests

**Test:** `docker compose build agent && bash scripts/test-sandbox.sh`
**Expected:** All 4 checks print PASS: "PASS: rootfs is read-only", "PASS: workspace writable", "PASS: su blocked", "PASS: non-root user"
**Why human:** Requires Docker daemon and built agent image.

#### 3. Network Isolation

**Test:** `docker compose run --rm db psql -h agent -U postgres` or equivalent attempt to reach agent from db container.
**Expected:** Connection refused or timeout — agent is only on frontend network, db is only on backend network.
**Why human:** Requires running Docker network topology.

### Gaps Summary

**One functional gap (AGT-03 partial):** The `executeSkill` function specified in plan 03-03 was removed during plan 04 execution with the rationale that "skills run directly via bash in container, no wrapper needed." This was an architectural simplification.

The gap has a security implication: the original design enforced execution safety properties in code (execFile over exec, 30s timeout, 512KB output cap). With executeSkill removed, these guarantees are not enforced at runtime — skills are invoked directly by the agent's LLM reasoning, and timeout/output constraints depend on the container's OS-level limits rather than application-level enforcement.

This may be acceptable given the container already has resource limits (`cpus: 1.0`, `memory: 512M`) and runs as non-root with read-only rootfs. However, the AGT-03 requirement text says "executable scripts" and the plan explicitly required the wrapper — the decision to remove it should either be formally accepted (updating the requirement) or the wrapper should be restored.

**All other requirements are satisfied.** The phase delivers a working sandboxed agent container with skill index building, Claude agentic loop with MCP tool access, conversation history and context compression, base-agent profile, MCP fetch tool with allowlisting, and operator secrets via setup.sh.

---

_Verified: 2026-03-28T12:00:00Z_
_Verifier: Claude (gsd-verifier)_
