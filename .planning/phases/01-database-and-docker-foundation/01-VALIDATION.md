---
phase: 1
slug: database-and-docker-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
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

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 1 | DB-01 | integration | `docker compose up -d && docker compose ps` | ❌ W0 | ⬜ pending |
| 1-01-02 | 01 | 1 | DB-02 | integration | `bash tests/phase-01/test-schema.sh` | ❌ W0 | ⬜ pending |
| 1-01-03 | 01 | 1 | DB-03 | integration | `bash tests/phase-01/test-rls.sh` | ❌ W0 | ⬜ pending |
| 1-01-04 | 01 | 1 | DB-04 | integration | `bash tests/phase-01/test-rls.sh` | ❌ W0 | ⬜ pending |
| 1-01-05 | 01 | 1 | DB-05 | integration | `bash tests/phase-01/test-semantic-search.sh` | ❌ W0 | ⬜ pending |
| 1-02-01 | 02 | 2 | INF-01 | integration | `bash tests/phase-01/test-network.sh` | ❌ W0 | ⬜ pending |
| 1-02-02 | 02 | 2 | INF-02 | integration | `bash tests/phase-01/test-secrets.sh` | ❌ W0 | ⬜ pending |
| 1-02-03 | 02 | 2 | INF-03 | integration | `docker inspect talos-postgres 2>/dev/null | grep -i password` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/phase-01/smoke.sh` — docker compose up + basic connectivity
- [ ] `tests/phase-01/test-schema.sh` — verify tables, extensions, vector columns exist
- [ ] `tests/phase-01/test-rls.sh` — RLS enforcement and agent isolation
- [ ] `tests/phase-01/test-semantic-search.sh` — match_entries function returns correct results
- [ ] `tests/phase-01/test-network.sh` — agent network cannot reach postgres, mcp can
- [ ] `tests/phase-01/test-secrets.sh` — no secrets in image layers or env dumps
- [ ] `tests/phase-01/run-all.sh` — orchestrates all above tests

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `docker inspect` shows no plaintext secrets | INF-03 | Requires human review of all inspect fields | Run `docker inspect $(docker ps -q)` and visually confirm no API keys or passwords visible |
| Image layer secret scan | INF-03 | Layer history scanning | Run `docker history --no-trunc <image>` and confirm no secrets in build args or ENV |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
