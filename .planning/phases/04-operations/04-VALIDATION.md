---
phase: 4
slug: operations
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-27
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 7.x |
| **Config file** | pytest.ini or pyproject.toml (Wave 0 installs if missing) |
| **Quick run command** | `pytest tests/phase04/ -x -q` |
| **Full suite command** | `pytest tests/phase04/ -v` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pytest tests/phase04/ -x -q`
- **After every plan wave:** Run `pytest tests/phase04/ -v`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | INF-04 | unit | `pytest tests/phase04/test_audit.py -x -q` | ❌ W0 | ⬜ pending |
| 04-01-02 | 01 | 1 | INF-04 | integration | `pytest tests/phase04/test_audit_integration.py -x -q` | ❌ W0 | ⬜ pending |
| 04-02-01 | 02 | 1 | INF-05 | integration | `pytest tests/phase04/test_backup.py -x -q` | ❌ W0 | ⬜ pending |
| 04-02-02 | 02 | 2 | INF-05 | integration | `pytest tests/phase04/test_restore.py -x -q` | ❌ W0 | ⬜ pending |
| 04-03-01 | 03 | 1 | INF-06 | integration | `pytest tests/phase04/test_docker_portability.py -x -q` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/phase04/__init__.py` — package init
- [ ] `tests/phase04/test_audit.py` — unit stubs for INF-04 audit middleware
- [ ] `tests/phase04/test_audit_integration.py` — integration stubs for audit log entries
- [ ] `tests/phase04/test_backup.py` — integration stubs for pg_dump backup flow
- [ ] `tests/phase04/test_restore.py` — integration stubs for backup-restore cycle
- [ ] `tests/phase04/test_docker_portability.py` — portability grep check stubs for INF-06
- [ ] `tests/phase04/conftest.py` — shared fixtures (DB connection, container handles)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Docker image runs on Linux without Mac-specific config | INF-06 | Requires Linux Docker host to verify | Build image, run on Linux host, confirm no host.docker.internal errors |
| Semantic search returns same results after restore | INF-05 | Requires full data population + restore cycle | Run backup, wipe DB, restore, query pgvector index, compare results |

---

## Validation Architecture

### Audit Log (INF-04)
- MCP middleware intercepts write operations and inserts audit_log entry in same transaction
- Test: mock DB session, call write operation, assert audit_log entry created with agent_id, operation, timestamp
- RLS policy test: verify mcp_service cannot write audit entry for different agent than active session

### Backup/Restore (INF-05)
- `docker exec pg pg_dump -Fc` produces binary dump file on host
- Test: create known data, run backup script, wipe DB, run restore script, query data, assert match
- Retention test: confirm old backups deleted only after new backup verified complete

### Docker Portability (INF-06)
- Static grep: `grep -r 'host.docker.internal' docker-compose.yml` must return empty
- `extra_hosts: host-gateway` in dev profile is the correct cross-platform pattern
- Test: parse docker-compose.yml, assert no host.docker.internal references

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
