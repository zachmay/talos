---
phase: 6
slug: text-ui-client
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-28
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (existing project setup) |
| **Config file** | vitest.config.ts or package.json scripts |
| **Quick run command** | `npm run test -- --run` |
| **Full suite command** | `npm run test -- --run --reporter=verbose` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run test -- --run`
- **After every plan wave:** Run `npm run test -- --run --reporter=verbose`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 20 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 6-01-01 | 01 | 0 | SSE streaming | unit | `npm run test -- --run src/agent/api` | ❌ W0 | ⬜ pending |
| 6-01-02 | 01 | 0 | Token auth | unit | `npm run test -- --run src/agent/auth` | ❌ W0 | ⬜ pending |
| 6-02-01 | 02 | 1 | TUI render | unit | `npm run test -- --run tui/src` | ❌ W0 | ⬜ pending |
| 6-02-02 | 02 | 1 | SSE client | unit | `npm run test -- --run tui/src/sse` | ❌ W0 | ⬜ pending |
| 6-03-01 | 03 | 2 | Chat display | manual | N/A — visual | N/A | ⬜ pending |
| 6-03-02 | 03 | 2 | Scroll behavior | manual | N/A — visual | N/A | ⬜ pending |
| 6-04-01 | 04 | 2 | `/btw` inject | unit | `npm run test -- --run src/agent/btw` | ❌ W0 | ⬜ pending |
| 6-04-02 | 04 | 3 | CLI entry point | integration | `./talos chat --help` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/agent/__tests__/api.test.ts` — stubs for Express HTTP + SSE endpoint
- [ ] `src/agent/__tests__/auth.test.ts` — bearer token validation
- [ ] `tui/src/__tests__/sse-client.test.ts` — SSE consumer (fetch-based)
- [ ] `src/agent/__tests__/btw.test.ts` — `/btw` injection queue
- [ ] Verify `ink-text-input` / `ink-select-input` peer dep resolution with Ink v6 + React 19

*All test files created as stubs in Wave 0 before implementation begins.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Chat display layout | CONTEXT: chat display | Visual/TUI rendering | Run `./talos chat`, verify "You:" green / "Agent:" blue labels, timestamps, spacing |
| Smart auto-scroll | CONTEXT: auto-scroll | Requires terminal interaction | Scroll up mid-stream, verify pinning; scroll to bottom, verify auto-resume |
| Thinking collapsible | CONTEXT: thinking display | Interactive TUI state | Start agent turn, verify thinking block collapses by default, expand with key |
| Tool call badges | CONTEXT: tool display | Visual inline rendering | Run agent with tool use, verify stacked inline badges appear |
| `/btw` UX | CONTEXT: soft-interrupt | Live TUI interaction | Type `/btw` during agent turn, verify message queued and injected after |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 20s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
