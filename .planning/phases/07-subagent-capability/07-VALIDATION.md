---
phase: 7
slug: subagent-capability
status: draft
nyquist_compliant: false
wave_0_complete: false
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
| 7-01-01 | 01 | 0 | subagent-core | unit | `npx jest --testPathPattern=subagent` | ❌ W0 | ⬜ pending |
| 7-01-02 | 01 | 1 | subagent-core | unit | `npx jest --testPathPattern=subagent` | ❌ W0 | ⬜ pending |
| 7-02-01 | 02 | 2 | subagent-collect | unit | `npx jest --testPathPattern=collect` | ❌ W0 | ⬜ pending |
| 7-03-01 | 03 | 3 | subagent-profile | unit | `npx jest --testPathPattern=profile` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/__tests__/subagent.test.ts` — stubs for subagent spawn/coordinate
- [ ] `src/__tests__/collect_results.test.ts` — stubs for parallel result collection
- [ ] `src/__tests__/profiles.test.ts` — stubs for profile discovery

*Existing ts-jest infrastructure covers all phase requirements; only test stubs needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Subagent SSE events in TUI | Phase 6 integration | Requires running TUI client | Start agent with subagent task, observe badge updates in TUI |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
