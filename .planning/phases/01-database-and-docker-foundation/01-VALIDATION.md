---
phase: 1
slug: database-and-docker-foundation
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-27
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bash + psql integration tests |
| **Config file** | tests/phase-01/ |
| **Quick run command** | `bash tests/phase-01/smoke.sh` |
| **Full suite command** | `bash tests/phase-01/run-all.sh` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bash tests/phase-01/smoke.sh`
- **After every plan wave:** Run `bash tests/phase-01/run-all.sh`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| 1-01-01 | 01 | 1 | INF-03 | static | `bash scripts/setup.sh && ls secrets/` | ⬜ pending |
| 1-01-02 | 01 | 1 | INF-03 | static | `git status secrets/ \| grep -q "nothing to commit"` | ⬜ pending |
| 1-02-01 | 02 | 1 | DB-01–DB-09 | static | `ls db/init/*.{sh,sql,sql.tpl}` | ⬜ pending |
| 1-02-02 | 02 | 1 | DB-01–DB-09 | static | `bash -n db/init/*.sh && echo "PASS: init scripts parse"` | ⬜ pending |
| 1-03-01 | 03 | 2 | INF-01, INF-02 | integration | `docker compose config --quiet && echo PASS` | ⬜ pending |
| 1-03-02 | 03 | 2 | INF-01–INF-03, DB-01–DB-09 | integration | `ls tests/phase-01/*.sh` | ⬜ pending |
| 1-03-03 | 03 | 2 | all | integration | `bash tests/phase-01/run-all.sh` (human checkpoint) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 — Test Scripts (created by Plan 03, Task 2)

All test scripts are created as part of Plan 03 Task 2 — they are the artifacts being built, not
pre-existing scaffolds. Wave 0 is satisfied when Task 2 completes and `ls tests/phase-01/*.sh`
shows all 7 scripts.

- [x] `tests/phase-01/smoke.sh` — docker compose up + basic connectivity
- [x] `tests/phase-01/test-schema.sh` — verify tables, extensions, vector columns exist
- [x] `tests/phase-01/test-rls.sh` — RLS enforcement and agent isolation (transaction-scoped)
- [x] `tests/phase-01/test-semantic-search.sh` — match_entries function returns correct results
- [x] `tests/phase-01/test-network.sh` — agent network cannot reach postgres, mcp can
- [x] `tests/phase-01/test-secrets.sh` — no secrets in image layers or env dumps
- [x] `tests/phase-01/run-all.sh` — orchestrates all above tests

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `docker inspect` shows no plaintext secrets | INF-03 | Requires human review of all inspect fields | Run `docker inspect $(docker ps -q)` and visually confirm no API keys or passwords visible |
| Image layer secret scan | INF-03 | Layer history scanning | Run `docker history --no-trunc <image>` and confirm no secrets in build args or ENV |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify commands
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covered — test scripts created by Plan 03 Task 2
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
