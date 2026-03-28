---
phase: 3
slug: agent-harness
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-27
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | jest 29.x (Node.js) |
| **Config file** | `jest.config.js` — Wave 0 creates |
| **Quick run command** | `docker compose exec agent npm test -- --testPathPattern=unit` |
| **Full suite command** | `docker compose exec agent npm test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `docker compose exec agent npm test -- --testPathPattern=unit`
- **After every plan wave:** Run `docker compose exec agent npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 3-01-01 | 01 | 0 | AGT-01 | infra | `docker build -f agent/Dockerfile.base .` | ❌ W0 | ⬜ pending |
| 3-01-02 | 01 | 0 | AGT-01 | infra | `docker build -f agent/Dockerfile.claude .` | ❌ W0 | ⬜ pending |
| 3-01-03 | 01 | 1 | AGT-01 | integration | `docker compose run --rm agent node -e "require('./src/index.js')"` | ❌ W0 | ⬜ pending |
| 3-02-01 | 02 | 1 | AGT-02 | unit | `docker compose exec agent npm test -- --testPathPattern=sandbox` | ❌ W0 | ⬜ pending |
| 3-02-02 | 02 | 1 | AGT-02 | manual | See Manual Verifications | N/A | ⬜ pending |
| 3-02-03 | 02 | 1 | AGT-03 | unit | `docker compose exec agent npm test -- --testPathPattern=skills` | ❌ W0 | ⬜ pending |
| 3-03-01 | 03 | 2 | AGT-03 | integration | `docker compose exec agent npm test -- --testPathPattern=skill-loader` | ❌ W0 | ⬜ pending |
| 3-03-02 | 03 | 2 | AGT-04 | integration | `docker compose exec agent npm test -- --testPathPattern=mcp-client` | ❌ W0 | ⬜ pending |
| 3-03-03 | 03 | 2 | AGT-04 | manual | See Manual Verifications | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `agent/tests/unit/sandbox.test.js` — stubs for AGT-01, AGT-02
- [ ] `agent/tests/unit/skills.test.js` — stubs for AGT-03
- [ ] `agent/tests/integration/skill-loader.test.js` — stubs for AGT-03
- [ ] `agent/tests/integration/mcp-client.test.js` — stubs for AGT-04
- [ ] `agent/jest.config.js` — jest config with testMatch patterns
- [ ] `npm install --save-dev jest` in agent package (if not present)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Sandbox escape attempt fails | AGT-02 | Requires host-level inspection of syscall interception; not automatable inside container | Run `docker compose run --rm agent node -e "require('fs').readFileSync('/etc/hosts')"` — must fail or be blocked; try `process.binding('spawn_sync')` |
| Agent executes skill script calling MCP tool end-to-end | AGT-04 | Full E2E requires live MCP server + Anthropic API key | Start stack with `docker compose up`, send test prompt via API, observe skill execution in logs |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
