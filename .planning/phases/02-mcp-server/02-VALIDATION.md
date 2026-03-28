---
phase: 2
slug: mcp-server
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-27
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest + Supertest |
| **Config file** | `mcp/vitest.config.ts` — Wave 0 creates this |
| **Quick run command** | `cd mcp && npx vitest run tests/auth.test.ts tests/providers/factory.test.ts` |
| **Full suite command** | `cd mcp && npx vitest run` |
| **Estimated runtime** | ~30 seconds (unit); ~60 seconds (full with integration) |

---

## Sampling Rate

- **After every task commit:** Run `cd mcp && npx vitest run tests/auth.test.ts tests/providers/factory.test.ts`
- **After every plan wave:** Run `cd mcp && npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 2-auth | TBD | 1 | MCP-07 | unit | `cd mcp && npx vitest run tests/auth.test.ts` | ❌ W0 | ⬜ pending |
| 2-provider-factory | TBD | 1 | MCP-05 | unit | `cd mcp && npx vitest run tests/providers/factory.test.ts` | ❌ W0 | ⬜ pending |
| 2-provider-interface | TBD | 1 | MCP-06 | unit | `cd mcp && npx vitest run tests/providers/interface.test.ts` | ❌ W0 | ⬜ pending |
| 2-insert | TBD | 2 | MCP-01 | integration | `cd mcp && npx vitest run tests/tools/insert.test.ts` | ❌ W0 | ⬜ pending |
| 2-search | TBD | 2 | MCP-02 | integration | `cd mcp && npx vitest run tests/tools/search.test.ts` | ❌ W0 | ⬜ pending |
| 2-update | TBD | 2 | MCP-03 | integration | `cd mcp && npx vitest run tests/tools/update.test.ts` | ❌ W0 | ⬜ pending |
| 2-delete | TBD | 2 | MCP-04 | integration | `cd mcp && npx vitest run tests/tools/delete.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `mcp/vitest.config.ts` — test framework config
- [ ] `mcp/tests/auth.test.ts` — stubs for MCP-07
- [ ] `mcp/tests/providers/factory.test.ts` — stubs for MCP-05
- [ ] `mcp/tests/providers/interface.test.ts` — stubs for MCP-06
- [ ] `mcp/tests/tools/insert.test.ts` — stubs for MCP-01
- [ ] `mcp/tests/tools/search.test.ts` — stubs for MCP-02
- [ ] `mcp/tests/tools/update.test.ts` — stubs for MCP-03
- [ ] `mcp/tests/tools/delete.test.ts` — stubs for MCP-04
- [ ] Framework install: `cd mcp && npm install --save-dev vitest supertest @types/supertest`

**Note:** MCP-01 through MCP-04 integration tests require a live Postgres instance (docker compose test profile). Unit tests (MCP-05 through MCP-07) mock all dependencies.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Switching EMBEDDING_PROVIDER env var in production | MCP-05 | Requires live deployment with real provider credentials | Set EMBEDDING_PROVIDER=ollama, restart server, run insert+search, verify embeddings come from Ollama |
| Cross-agent isolation end-to-end | MCP-07 | Requires two real agent API keys and live DB | Insert with agent-A key, attempt search with agent-B key, verify zero results returned |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
