---
phase: 7
slug: subagent-capability
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-28
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | jest 29.x / ts-jest |
| **Config file** | jest.config.ts |
| **Quick run command** | `npx jest --testPathPattern=subagent` |
| **Full suite command** | `npx jest` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx jest --testPathPattern=subagent`
- **After every plan wave:** Run `npx jest`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 7-01-01 | 01 | 0 | SUB-01 | unit | `cd agent && npm test -- --testPathPattern=local-tools` | ✅ W0 | ⬜ pending |
| 7-01-02 | 01 | 0 | SUB-03 | unit | `cd agent && npm test -- --testPathPattern="conversation-manager\|prompt"` | ✅ W0 | ⬜ pending |
| 7-02-01 | 02 | 2 | SUB-01 | unit | `cd agent && npm test -- --testPathPattern=local-tools` | ✅ W0 | ⬜ pending |
| 7-02-02 | 02 | 2 | SUB-02 | unit | `cd agent && npm test -- --testPathPattern=local-tools` | ✅ W0 | ⬜ pending |
| 7-03-01 | 03 | 3 | SUB-04 | unit | `cd agent && npm test -- --testPathPattern=prompt` | ✅ W0 | ⬜ pending |
| 7-04-01 | 04 | 3 | SUB-01 | unit | `cd agent && npm test` | ✅ W0 | ⬜ pending |
| 7-05-01 | 05 | 4 | SUB-03 | unit | `cd agent && npm test -- --testPathPattern=conversation-manager` | ✅ W0 | ⬜ pending |
| 7-06-01 | 06 | 5 | SUB-03 | compile | `cd agent && npx tsc --noEmit` | n/a | ⬜ pending |
| 7-07-01 | 07 | 5 | SUB-05 | functional | `./talos profiles 2>&1 \| grep -c 'agent'` | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Wave 0 test stubs are created by Plan 07-01. Actual test files:

- [x] `agent/src/__tests__/local-tools.test.ts` — stubs for LocalToolRegistry + spawn_subagent + collect_results handlers
- [x] `agent/src/__tests__/conversation-manager.test.ts` — stubs for ConversationManager
- [x] `agent/src/__tests__/prompt.test.ts` (extended) — stubs for discoverProfiles() and buildSubagentGuidance()

*Existing ts-jest infrastructure covers all phase requirements; only test stubs needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Subagent SSE events in TUI | Phase 6 integration | Requires running TUI client | Start agent with subagent task, observe badge updates in TUI |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** reconciled 2026-03-28
