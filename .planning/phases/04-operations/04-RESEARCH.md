# Phase 4: Operations - Research

**Researched:** 2026-03-27
**Domain:** PostgreSQL audit logging, pg_dump backup/restore, Docker Compose portability, shell CLI tooling
**Confidence:** HIGH (core patterns are stable, well-documented)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Audit Logging**
- Dedicated `audit_log` table in Postgres (queryable, persistent, survives container restarts)
- RLS on audit entries — agents see only their own audit trail
- Schema designed to be v2-ready for version history extension (DB-V2-01)
- Separate from MCP's stdout operational logs (Phase 2) — audit = accountability, stdout = monitoring

**Backup & Restore**
- pg_dump with custom format (-Fc) for compressed, portable backups
- Supporting scripts for frictionless operation (`./talos backup`, `./talos restore`)
- Backups stored in local `./backups/` directory (bind mount, gitignored)
- Configurable retention: keep last N backups (default: 7), auto-delete older
- Restore script includes auto-verification: checks pgvector extension, row counts, semantic search functionality, RLS policies

**Cloud-Ready Images**
- No Mac-only assumptions in core compose — any Docker Desktop shortcuts isolated to dev profile only
- Docker Compose only (no K8s manifests for now)
- No container registry — users clone and build locally
- Core compose must "just work" on any Docker host or be deployable to cloud/K8s with minimal adaptation
- Any Mac-specific dev conveniences must not leak into default behavior

**Operational CLI**
- Shell scripts in `scripts/` with a `./talos` wrapper script for routing
- Key scripts: backup, restore, add-agent, audit, health, status
- Audit query script supports filtering: by agent, operation type, date range, entry ID. Output as table or JSON.
- End-to-end health check script: verifies DB + extensions, MCP reachability + auth, agent running, network isolation, RLS, disk usage

### Claude's Discretion
- Audit table exact schema (columns, indexes, details JSONB structure)
- Whether audit entries capture before/after metadata or just operation + entry_id
- pg_dump scheduling (cron vs manual-only)
- Health check implementation details
- `talos` wrapper script argument parsing approach

### Deferred Ideas (OUT OF SCOPE)
- Container registry publishing (GHCR/Docker Hub)
- Kubernetes manifests / Helm chart
- WAL archiving for point-in-time recovery
- S3-compatible backup storage
- Scheduled automatic backups (cron)
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INF-04 | Audit logging for all write operations | PostgreSQL table + RLS + MCP middleware hook pattern; trigger-based alternative also documented |
| INF-05 | Backup and restore tooling for the DB | pg_dump -Fc, pg_restore, named volume access via `--network host` or exec pattern, verification queries |
| INF-06 | Cloud-ready portable Docker images | Eliminate `host.docker.internal`, use service DNS names, compose profile isolation for Mac conveniences |
</phase_requirements>

---

## Summary

Phase 4 delivers the operational layer that makes Talos production-trustworthy: accountability (audit trail), resilience (backup/restore), and portability (cloud-ready images). All three domains use mature, stable technology — PostgreSQL DDL for audit tables, the `pg_dump` CLI for backups, and Docker Compose profile discipline for portability. No new framework dependencies are introduced.

The main design challenge is the audit logging integration point: MCP server TypeScript code must write an audit row on every mutation. This is application-level middleware, not a database trigger, because the agent identity (`app.agent_id`) is a session variable known only to the MCP layer. A database trigger cannot reliably read the session variable in all transaction contexts, so the canonical approach for this project is MCP-layer instrumentation.

Backup/restore is entirely standard `pg_dump`/`pg_restore` with a thin shell wrapper. The verification step after restore — checking pgvector, row counts, RLS behavior, and a live semantic search — is the differentiating quality gate. Cloud portability requires a systematic audit of the compose files for Mac-only networking shortcuts and their replacement with service-name DNS.

**Primary recommendation:** Instrument audit writes in MCP TypeScript middleware (not DB triggers), use pg_dump -Fc with named-volume exec access, and do a compose-profile audit to isolate all Mac conveniences to the `dev` profile.

---

## Standard Stack

### Core

| Library / Tool | Version | Purpose | Why Standard |
|----------------|---------|---------|--------------|
| PostgreSQL (existing) | 17 (pgvector image) | Audit log storage | Already present; queryable, persistent, RLS-capable |
| pg_dump / pg_restore | bundled with Postgres 17 | Backup and restore | Official Postgres tooling; -Fc format is compressed, directory-restore-capable |
| Docker Compose | v2 (existing) | Service orchestration | Already in use; profiles isolate dev conveniences |
| Bash | POSIX-compatible | `talos` CLI wrapper + scripts | No extra dependency; works on Linux and macOS |

### Supporting

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `psql` (bundled with pgvector image) | Verification queries in restore script | Run after pg_restore to verify row counts, extensions, RLS |
| `docker exec` | Run pg_dump/pg_restore inside the db container | Avoids needing Postgres client on host; uses container's bundled tools |
| `column` (coreutils) | Table-formatted audit output in CLI | When `--format table` selected in `talos audit` |
| `jq` | JSON audit output formatting | When `--format json` selected; optional dependency, degrade gracefully |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Application-layer audit writes (MCP) | DB trigger via `pg_audit` extension | Trigger approach misses session-variable agent identity; pg_audit is a separate extension not in the pgvector base image |
| `docker exec pg_dump` | Host-installed pg_dump via TCP | Requires version-matched client on host; exec approach is hermetic |
| Bash `./talos` wrapper | Python/Node CLI tool | Shell has no dependencies; Node already present but overkill for routing |
| Manual retention | `find -mtime` in backup script | Both work; find is portable POSIX |

**Installation:** No new packages required. pg_dump, psql, and pg_restore are bundled in the `pgvector/pgvector:pg17` image.

---

## Architecture Patterns

### Recommended Project Structure

```
scripts/
├── talos              # Main wrapper script (chmod +x)
├── backup.sh          # pg_dump + retention cleanup
├── restore.sh         # pg_restore + verification
├── audit.sh           # Query audit_log with filters
├── health.sh          # End-to-end health check
├── status.sh          # Service status summary
└── add-agent.sh       # Agent credential provisioning (Phase 3 complement)

db/
└── init/
    └── 05-audit.sql   # audit_log table DDL (numbered after existing init scripts)

backups/               # Runtime directory, gitignored
└── .gitkeep
```

### Pattern 1: MCP Middleware Audit Writes

**What:** A TypeScript middleware function wraps all MCP tool handlers that perform writes. Before returning the tool result, it writes one row to `audit_log` using the same database connection (same transaction when possible).

**When to use:** Every MCP write tool: insert, update, delete. Read operations (search, list) are not audited per the phase scope.

**Design rationale:** The agent identity is available in the MCP handler context as `agentId` (set during auth in Phase 2/3). A database trigger sees only the SQL; it cannot reliably access `current_setting('app.agent_id')` unless the MCP always sets it — and if MCP is already executing the write, it can equally execute the audit INSERT directly.

**Example:**
```typescript
// Audit middleware pattern (MCP TypeScript, Phase 2 codebase)
async function withAudit(
  db: PoolClient,
  agentId: string,
  operation: 'insert' | 'update' | 'delete',
  targetId: string | null,
  details: Record<string, unknown>,
  fn: () => Promise<unknown>
): Promise<unknown> {
  const result = await fn();
  await db.query(
    `INSERT INTO audit_log (agent_id, operation, target_id, details)
     VALUES ($1, $2, $3, $4)`,
    [agentId, operation, targetId, JSON.stringify(details)]
  );
  return result;
}
```

**Transaction note:** If the write and audit INSERT share a transaction, a rolled-back write also rolls back the audit entry (correct behavior — no phantom audit entries for failed operations). If separate connections are used, a failed write followed by a crash before the audit INSERT creates a gap. Use the same connection/transaction.

### Pattern 2: Audit Table Schema

**What:** Minimal, forward-compatible schema. The `details` JSONB column is the extension point for v2 (before/after snapshots, additional metadata).

```sql
-- db/init/05-audit.sql
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  agent_id    TEXT        NOT NULL,
  operation   TEXT        NOT NULL CHECK (operation IN ('insert', 'update', 'delete')),
  target_id   UUID,                          -- entries.id or chunks.id (NULL for bulk ops)
  details     JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for per-agent queries (RLS + audit query tool both benefit)
CREATE INDEX audit_log_agent_idx      ON audit_log (agent_id);
-- Index for time-range filtering
CREATE INDEX audit_log_created_at_idx ON audit_log (created_at DESC);
-- Index for entry-level lookup (v2 version history)
CREATE INDEX audit_log_target_idx     ON audit_log (target_id) WHERE target_id IS NOT NULL;

-- RLS: each agent sees only their own audit trail
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

CREATE POLICY audit_log_agent_isolation ON audit_log
  USING (agent_id = current_setting('app.agent_id', true));

-- mcp_service role needs INSERT + SELECT
GRANT SELECT, INSERT ON audit_log TO mcp_service;
GRANT USAGE, SELECT ON SEQUENCE audit_log_id_seq TO mcp_service;
```

**v2-readiness:** The `details` JSONB column can carry `{"before": {...}, "after": {...}}` when DB-V2-01 is implemented. No schema migration needed for the column — only the MCP code that populates it changes.

### Pattern 3: pg_dump / pg_restore via docker exec

**What:** Run pg_dump inside the db container using `docker exec`. This uses the version-matched tooling bundled in the image and avoids requiring a host Postgres client.

```bash
# backup.sh core logic
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="backups/talos_${TIMESTAMP}.dump"

docker exec talos-db-1 pg_dump \
  -U postgres \
  -Fc \                         # Custom format: compressed, supports selective restore
  --no-password \               # Password via PGPASSWORD env or .pgpass
  talos \                       # Database name
  > "$BACKUP_FILE"

echo "Backup written: $BACKUP_FILE"
```

**Restore flow:**
```bash
# restore.sh core logic
docker exec -i talos-db-1 pg_restore \
  -U postgres \
  --clean \                     # Drop objects before recreating
  --if-exists \                 # Don't error on missing objects
  -d talos \
  < "$BACKUP_FILE"
```

**Named volume access note:** `docker exec` runs inside the container where the named volume is already mounted. No special volume access is needed. The dump goes to stdout and is captured by the host shell — it does NOT need to be written inside the container first.

### Pattern 4: Restore Verification

**What:** After pg_restore completes, the restore script runs a sequence of psql verification queries.

```bash
# Verification queries executed via psql inside container
verify_restore() {
  local DB="talos"

  # 1. pgvector extension present
  docker exec talos-db-1 psql -U postgres -d "$DB" -c \
    "SELECT extname FROM pg_extension WHERE extname = 'vector';" | grep -q vector
  echo "[OK] pgvector extension present"

  # 2. entries row count > 0 (or matches pre-backup count if stored)
  COUNT=$(docker exec talos-db-1 psql -U postgres -d "$DB" -tAc "SELECT COUNT(*) FROM entries;")
  echo "[OK] entries table: $COUNT rows"

  # 3. RLS enabled on entries and chunks
  docker exec talos-db-1 psql -U postgres -d "$DB" -c \
    "SELECT tablename, rowsecurity FROM pg_tables WHERE tablename IN ('entries','chunks','audit_log');"

  # 4. Smoke-test semantic search function exists
  docker exec talos-db-1 psql -U postgres -d "$DB" -c \
    "SELECT proname FROM pg_proc WHERE proname = 'match_entries';" | grep -q match_entries
  echo "[OK] match_entries function present"
}
```

### Pattern 5: `talos` Wrapper CLI

**What:** A single executable shell script that dispatches to subscripts. Argument parsing uses positional parameters and a `case` statement — no external parser needed.

```bash
#!/usr/bin/env bash
# ./talos — Talos operational CLI
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS="$SCRIPT_DIR/scripts"

usage() {
  echo "Usage: ./talos <command> [options]"
  echo ""
  echo "Commands:"
  echo "  backup              Create a database backup"
  echo "  restore <file>      Restore from a backup file"
  echo "  audit               Query audit log"
  echo "  health              Run end-to-end health check"
  echo "  status              Show service status"
  echo "  add-agent <name>    Provision a new agent identity"
  exit 1
}

COMMAND="${1:-}"
shift || true

case "$COMMAND" in
  backup)    exec "$SCRIPTS/backup.sh" "$@" ;;
  restore)   exec "$SCRIPTS/restore.sh" "$@" ;;
  audit)     exec "$SCRIPTS/audit.sh" "$@" ;;
  health)    exec "$SCRIPTS/health.sh" "$@" ;;
  status)    exec "$SCRIPTS/status.sh" "$@" ;;
  add-agent) exec "$SCRIPTS/add-agent.sh" "$@" ;;
  *)         usage ;;
esac
```

### Pattern 6: Docker Compose Portability Audit

**What:** Systematic review of compose files for Mac-only networking constructs. Key pattern to eliminate from core compose: `host.docker.internal` (a Docker Desktop Mac/Windows alias for the host machine's IP, not available on Linux Docker Engine).

**Replacement patterns:**
```yaml
# WRONG (Mac-only): service calling back to host
environment:
  - EMBEDDING_API_URL=http://host.docker.internal:11434

# RIGHT (portable): if service is containerized, use service name
environment:
  - EMBEDDING_API_URL=http://ollama:11434

# RIGHT (portable): if host access is genuinely needed, use extra_hosts
# (only in dev profile)
services:
  mcp:
    profiles: [dev]
    extra_hosts:
      - "host.docker.internal:host-gateway"  # Linux-compatible
```

**`host-gateway` note:** Docker Compose v2 supports `host-gateway` as a special value that resolves to the host IP on both Linux and Docker Desktop. This is the correct cross-platform approach when host access is legitimately needed (dev profile only).

### Anti-Patterns to Avoid

- **Audit writes outside the transaction:** Inserting to `audit_log` after `COMMIT` means a crash between the two leaves no audit trail for the write that succeeded. Keep audit INSERT in the same transaction as the data write.
- **pg_dump via TCP from host:** Requires a host-installed `psql`/`pg_dump` at the exact matching major version. The `docker exec` pattern is hermetic.
- **Writing backup files inside the container:** If the container restarts or is removed, backups are lost. Always stream to stdout and capture on the host.
- **`host.docker.internal` in the default compose profile:** Works on Mac, silently fails on Linux. Move to `dev` profile with `extra_hosts: host-gateway`.
- **Audit table without RLS:** An agent querying audit history without RLS could enumerate other agents' operations, breaking the isolation model.
- **Hardcoded container names in scripts:** Container names follow `<project>-<service>-<n>` convention (e.g., `talos-db-1`). The compose project name can vary. Use `docker compose exec db` instead of `docker exec talos-db-1` where possible to let compose resolve the container.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Compressed backup format | Custom gzip wrapper around SQL dump | `pg_dump -Fc` | -Fc handles compression, selective restore, parallel restore natively |
| Backup verification | Custom checksums | `pg_restore --list` + `psql` verification queries | pg_restore can list contents; psql queries verify live DB state |
| Audit timestamp | Application-side `new Date()` | `DEFAULT now()` in schema | DB clock is authoritative; app clock can drift, be spoofed |
| Docker service name resolution | `host.docker.internal` + `/etc/hosts` | Docker named networks + service DNS | Built-in; no host dependency |
| CLI argument parsing | `getopt`-based option parser | Positional `case` dispatch | Simpler, portable, no GNU getopt dependency |

**Key insight:** Every tool in this phase has a 25+ year history of edge cases already handled (pg_dump, psql, Docker networking). Custom replacements will miss backup corruption detection, parallel restore, and cross-platform networking subtleties.

---

## Common Pitfalls

### Pitfall 1: Audit log missing on transaction rollback

**What goes wrong:** MCP writes an audit row in a separate connection after the data write commits. A crash between the two leaves an unaudited successful write. Alternatively, if audit is in the same transaction and the data write rolls back, the audit entry also rolls back — which is correct but can confuse operators who expected to see failed-attempt entries.

**How to avoid:** Keep audit INSERT in the same transaction. Document clearly: audit_log records committed writes only. Failed/rolled-back operations do not appear — this is the correct semantic for accountability.

**Warning signs:** Audit entries appearing for data that doesn't exist in the tables (phantom entries from separate connections that commit after the data rolls back).

### Pitfall 2: pg_dump password prompting in scripts

**What goes wrong:** pg_dump prompts for a password when run non-interactively, hanging the backup script.

**How to avoid:** Use `PGPASSWORD` environment variable or a `.pgpass` file inside the container. Since this project uses Docker secrets, read the secret file and pass it as `PGPASSWORD`:

```bash
PGPASSWORD=$(docker exec talos-db-1 cat /run/secrets/db_password) \
  docker exec talos-db-1 pg_dump -U postgres -Fc talos
```

Alternatively, configure the postgres superuser with `trust` auth for local socket connections (safe inside the container; the port is not exposed in prod profile).

**Warning signs:** Backup script appears to hang with no output.

### Pitfall 3: Restore drops live connections

**What goes wrong:** `pg_restore --clean` on a live database fails if other clients hold connections (MCP server still connected).

**How to avoid:** The restore script must stop dependent services before restoring:

```bash
# In restore.sh
docker compose stop mcp agent
# ... run pg_restore ...
docker compose start mcp agent
```

Or use `pg_restore --no-owner` + explicit connection termination:
```sql
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'talos' AND pid <> pg_backend_pid();
```

**Warning signs:** pg_restore error: `ERROR: database "talos" is being accessed by other users`.

### Pitfall 4: `docker compose exec` vs `docker exec` in scripts

**What goes wrong:** Scripts using `docker exec talos-db-1` break if the compose project name changes (different directory name, `COMPOSE_PROJECT_NAME` override).

**How to avoid:** Prefer `docker compose exec db` in scripts. This resolves the container via compose, respects project name. Requires the script to be run from the project root (where `docker-compose.yml` is). Document this requirement clearly.

**Warning signs:** Scripts fail with "No such container: talos-db-1" after renaming the project directory.

### Pitfall 5: Backup files grow unbounded

**What goes wrong:** Without retention enforcement, `./backups/` fills disk. A full disk causes pg_dump to fail mid-write, producing a corrupt backup.

**How to avoid:** Retention logic runs at the END of a successful backup (not before, to avoid deleting old backups before the new one is confirmed good):

```bash
# After successful backup, enforce retention
ls -t backups/talos_*.dump | tail -n +$((RETENTION + 1)) | xargs -r rm --
```

**Warning signs:** `df -h` shows backup partition near capacity; pg_dump output is smaller than expected.

### Pitfall 6: host.docker.internal silently works on Mac, fails on Linux

**What goes wrong:** Dev builds on Mac, ships compose to Linux host, services can't reach each other because `host.docker.internal` doesn't resolve.

**How to avoid:** Grep all compose files for `host.docker.internal` and `extra_hosts` entries before declaring cloud-readiness. Ensure the default/prod profile contains neither. Add a CI note (or health check verification step) that runs on Linux.

**Warning signs:** MCP service logs `ENOTFOUND host.docker.internal` or connection refused on Linux deploy.

---

## Code Examples

### Audit query script with filters

```bash
#!/usr/bin/env bash
# scripts/audit.sh
set -euo pipefail

AGENT=""
OPERATION=""
SINCE=""
UNTIL=""
ENTRY_ID=""
FORMAT="table"
LIMIT=100

while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent)     AGENT="$2";     shift 2 ;;
    --operation) OPERATION="$2"; shift 2 ;;
    --since)     SINCE="$2";     shift 2 ;;
    --until)     UNTIL="$2";     shift 2 ;;
    --entry)     ENTRY_ID="$2";  shift 2 ;;
    --format)    FORMAT="$2";    shift 2 ;;
    --limit)     LIMIT="$2";     shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Build WHERE clause dynamically
CONDITIONS=""
add_condition() {
  if [[ -n "$CONDITIONS" ]]; then CONDITIONS="$CONDITIONS AND $1"; else CONDITIONS="WHERE $1"; fi
}

[[ -n "$AGENT" ]]     && add_condition "agent_id = '$AGENT'"
[[ -n "$OPERATION" ]] && add_condition "operation = '$OPERATION'"
[[ -n "$SINCE" ]]     && add_condition "created_at >= '$SINCE'"
[[ -n "$UNTIL" ]]     && add_condition "created_at <= '$UNTIL'"
[[ -n "$ENTRY_ID" ]]  && add_condition "target_id = '$ENTRY_ID'"

SQL="SELECT id, agent_id, operation, target_id, created_at, details FROM audit_log $CONDITIONS ORDER BY created_at DESC LIMIT $LIMIT;"

if [[ "$FORMAT" == "json" ]]; then
  docker compose exec -T db psql -U postgres -d talos -tAc \
    "SELECT json_agg(t) FROM ($SQL) t;"
else
  docker compose exec -T db psql -U postgres -d talos -c "$SQL"
fi
```

### Health check structure

```bash
#!/usr/bin/env bash
# scripts/health.sh
set -euo pipefail

PASS=0
FAIL=0

check() {
  local label="$1"; shift
  if "$@" &>/dev/null; then
    echo "[PASS] $label"
    ((PASS++))
  else
    echo "[FAIL] $label"
    ((FAIL++))
  fi
}

# DB checks
check "DB is reachable"        docker compose exec -T db pg_isready -U postgres
check "pgvector extension"     docker compose exec -T db psql -U postgres -d talos -tAc "SELECT 1 FROM pg_extension WHERE extname='vector'" | grep -q 1
check "RLS on entries table"   docker compose exec -T db psql -U postgres -d talos -tAc "SELECT rowsecurity FROM pg_tables WHERE tablename='entries'" | grep -q t
check "match_entries function" docker compose exec -T db psql -U postgres -d talos -tAc "SELECT 1 FROM pg_proc WHERE proname='match_entries'" | grep -q 1
check "audit_log table"        docker compose exec -T db psql -U postgres -d talos -tAc "SELECT 1 FROM information_schema.tables WHERE table_name='audit_log'" | grep -q 1

# MCP checks
check "MCP container running"  docker compose ps mcp | grep -q running
check "MCP health endpoint"    curl -sf http://localhost:3000/health

# Network isolation (agent cannot reach DB directly)
# Omit in automated health — requires docker exec into agent container

# Disk usage
DISK=$(df -h backups/ 2>/dev/null | awk 'NR==2 {print $5}' | tr -d '%')
if [[ -n "$DISK" && "$DISK" -lt 80 ]]; then
  echo "[PASS] Backup disk usage: ${DISK}%"
  ((PASS++))
else
  echo "[WARN] Backup disk usage high: ${DISK}%"
fi

echo ""
echo "Health: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| `pg_dump` plain SQL format | `pg_dump -Fc` custom format | Compressed; parallel restore with `pg_restore -j`; selective table restore |
| `host.docker.internal` for host access | `extra_hosts: host-gateway` in dev profile | Cross-platform; works on Linux Docker Engine and Docker Desktop |
| Separate audit connection | Same-transaction audit INSERT | Atomicity: no audit entries for rolled-back writes |
| `getopt` option parsing in shell | Positional `case` + `shift` | No GNU getopt dependency; works on macOS BSD and Linux |

**Deprecated / avoid:**
- `pg_dump -Fp` (plain format): Not compressed, not selective, fine for small DBs but inferior for production backup use. Use `-Fc`.
- `docker-compose` (v1, Python): Project uses Docker Compose v2 (`docker compose` subcommand). Do not use the `docker-compose` binary in scripts.

---

## Open Questions

1. **Audit log RLS and the mcp_service role**
   - What we know: `mcp_service` role connects to DB; RLS on `audit_log` uses `current_setting('app.agent_id', true)` to filter rows.
   - What's unclear: For audit INSERTs, the MCP sets `app.agent_id` before the write — the RLS USING policy applies to SELECT, UPDATE, DELETE. INSERT is controlled by the WITH CHECK policy. Need to confirm whether a WITH CHECK policy is needed or if GRANT INSERT is sufficient.
   - Recommendation: Add `WITH CHECK (agent_id = current_setting('app.agent_id', true))` policy to prevent mcp_service from writing audit entries for a different agent than the active session. This is a correctness guarantee, not just security — belt-and-suspenders.

2. **pg_dump and Docker secrets password**
   - What we know: The postgres superuser password is stored as a Docker secret at `/run/secrets/db_password` inside the container.
   - What's unclear: `pg_dump` inside the container needs the password. Trust auth for local socket connections (default Postgres behavior for `postgres` superuser on Unix socket) may make the password unnecessary for `docker exec`-based access.
   - Recommendation: Verify in Wave 1 whether `docker exec db psql -U postgres` requires a password on the local socket. If trust auth is configured in `pg_hba.conf` for local connections (likely from Phase 1), pg_dump via exec requires no password.

3. **`talos audit` and RLS bypass**
   - What we know: The audit query script runs as postgres superuser (for admin access). RLS is bypassed for superuser by default in Postgres.
   - What's unclear: Should the operator-facing `./talos audit` query bypass RLS (see all agents) or impersonate an agent (see one agent's trail)?
   - Recommendation: Operator CLI (`./talos audit`) runs as postgres superuser — bypasses RLS by design, sees all agents. Filter by `--agent` flag for agent-specific views. This is correct: the operator's audit tool is not subject to per-agent isolation.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Bash + psql integration tests (no separate test framework; shell scripts with assertions) |
| Config file | None — scripts are self-contained |
| Quick run command | `bash scripts/health.sh` |
| Full suite command | `bash scripts/health.sh && bash scripts/backup.sh --dry-run && bash scripts/restore.sh --verify-only` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INF-04 | Write op through MCP produces audit_log entry with agent_id, operation, timestamp | Integration | `docker compose exec -T db psql -U postgres -d talos -c "SELECT COUNT(*) FROM audit_log WHERE operation='insert';"` after test insert | Wave 0 |
| INF-04 | RLS prevents agent from reading another agent's audit entries | Integration | psql query as mcp_service with different app.agent_id settings | Wave 0 |
| INF-05 | pg_dump produces non-empty backup file | Smoke | `bash scripts/backup.sh && ls -la backups/ | grep .dump` | Wave 0 |
| INF-05 | Restore produces identical row counts | Integration | `bash scripts/restore.sh <file>` includes row count assertion | Wave 0 |
| INF-05 | Semantic search works after restore | Integration | `match_entries` function present check in restore verification | Wave 0 |
| INF-06 | No `host.docker.internal` in non-dev compose | Static | `grep -r 'host.docker.internal' docker-compose.yml && exit 1 || exit 0` | Wave 0 |
| INF-06 | Services start on Linux Docker Engine profile | Smoke | Manual verification (CI on Linux or documented test step) | Manual |

### Sampling Rate
- **Per task commit:** `bash scripts/health.sh` (fast; verifies live service state)
- **Per wave merge:** Full backup + restore + verification cycle
- **Phase gate:** All health checks green + backup/restore cycle verified before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `scripts/backup.sh` — covers INF-05 backup
- [ ] `scripts/restore.sh` — covers INF-05 restore + verification
- [ ] `scripts/health.sh` — covers INF-04 + INF-06 smoke checks
- [ ] `scripts/audit.sh` — covers INF-04 query interface
- [ ] `db/init/05-audit.sql` — covers INF-04 schema
- [ ] `scripts/talos` — wrapper routing all above

---

## Sources

### Primary (HIGH confidence)

- PostgreSQL 17 official docs — `pg_dump`, `pg_restore`, `pg_hba.conf`, RLS policies, transaction semantics
- Docker Compose v2 official docs — `extra_hosts`, `host-gateway`, service DNS, profiles
- pgvector/pgvector Docker Hub image — bundled pg_dump/psql tooling
- Phase 1 RESEARCH.md — established patterns: named volumes, secrets, compose profiles, service names (`db`, `mcp`, `agent`)
- Phase 2/3 RESEARCH.md — MCP TypeScript middleware patterns, `scripts/` directory convention

### Secondary (MEDIUM confidence)

- Docker networking documentation for `host-gateway` — verified as the cross-platform replacement for `host.docker.internal` (Docker Compose v2.x, engine 20.10+)
- PostgreSQL RLS documentation — USING vs WITH CHECK policy semantics for INSERT verification

### Tertiary (LOW confidence)

- Specific behavior of trust auth for `postgres` superuser on Unix socket inside `docker exec` — needs verification in Wave 1 (open question #2 above)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all tools are bundled in existing images or POSIX shell; no new dependencies
- Architecture: HIGH — pg_dump -Fc, docker exec, compose profiles are stable, well-documented patterns
- Audit integration: HIGH — application-layer middleware is the correct pattern for session-variable-aware audit; DB trigger alternative documented and correctly rejected
- Pitfalls: HIGH — all pitfalls sourced from documented Postgres and Docker behavior, not speculation

**Research date:** 2026-03-27
**Valid until:** 2026-09-27 (stable ecosystem; pg_dump API and Docker Compose profile behavior change infrequently)
