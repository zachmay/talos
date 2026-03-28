---
phase: 5
slug: privacy-and-compliance
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-28
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bash (shell script tests via bats or direct assertions) |
| **Config file** | none — scripts are self-validating |
| **Quick run command** | `bash scripts/health.sh` |
| **Full suite command** | `bash scripts/security-audit.sh && bash scripts/network-audit.sh` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bash scripts/health.sh`
- **After every plan wave:** Run `bash scripts/security-audit.sh && bash scripts/network-audit.sh`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 5-01-01 | 01 | 1 | PRV-01 | manual | `cat SECURITY.md` | ❌ W0 | ⬜ pending |
| 5-01-02 | 01 | 1 | PRV-02 | manual | `cat SECURITY.md | grep "Open Security"` | ❌ W0 | ⬜ pending |
| 5-02-01 | 02 | 2 | PRV-02 | automated | `bash scripts/security-audit.sh --json` | ❌ W0 | ⬜ pending |
| 5-03-01 | 03 | 2 | PRV-02 | automated | `bash scripts/network-audit.sh` | ❌ W0 | ⬜ pending |
| 5-03-02 | 03 | 2 | PRV-02 | automated | `bash scripts/network-audit.sh --json` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `SECURITY.md` — stub with section headers for callout inventory + open questions
- [x] `scripts/security-audit.sh` — created fully by plan 05-02 (no stub needed)
- [x] `scripts/network-audit.sh` — created fully by plan 05-03 (no stub needed)

*Wave 0 creates empty/stub files so later tasks can verify existence and populate content.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| SECURITY.md callout inventory is accurate | PRV-01 | Requires human review of listed APIs | Read `SECURITY.md` and confirm all 3 callouts (OpenRouter, OpenAI, Anthropic) are listed with host, port, purpose |
| Open security questions are tracked | PRV-03 | Subjective completeness check | Verify `SECURITY.md` Open Questions section has ≥5 unresolved items with BLOCKING tags |
| DB port exposure warning shown | PRV-02 | Runtime behavior needs live stack | Run `bash scripts/network-audit.sh` against running stack; confirm `DB_PORT` binding warning appears |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
