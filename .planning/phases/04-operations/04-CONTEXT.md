# Phase 4: Operations - Context

**Gathered:** 2026-03-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Production-ready operational tooling: audit logging for all write operations, reliable backup/restore with verification, and cloud-portable Docker images. Covers INF-04, INF-05, INF-06.

</domain>

<decisions>
## Implementation Decisions

### Audit Logging
- Dedicated `audit_log` table in Postgres (queryable, persistent, survives container restarts)
- RLS on audit entries — agents see only their own audit trail
- Schema designed to be v2-ready for version history extension (DB-V2-01)
- Separate from MCP's stdout operational logs (Phase 2) — audit = accountability, stdout = monitoring

### Backup & Restore
- pg_dump with custom format (-Fc) for compressed, portable backups
- Supporting scripts for frictionless operation (`./talos backup`, `./talos restore`)
- Backups stored in local `./backups/` directory (bind mount, gitignored)
- Configurable retention: keep last N backups (default: 7), auto-delete older
- Restore script includes auto-verification: checks pgvector extension, row counts, semantic search functionality, RLS policies

### Cloud-Ready Images
- No Mac-only assumptions in core compose — any Docker Desktop shortcuts isolated to dev profile only
- Docker Compose only (no K8s manifests for now)
- No container registry — users clone and build locally
- Core compose must "just work" on any Docker host or be deployable to cloud/K8s with minimal adaptation
- Any Mac-specific dev conveniences must not leak into default behavior

### Operational CLI
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

</decisions>

<specifics>
## Specific Ideas

- Audit schema should be forward-compatible with v2 version history (DB-V2-01: trigger-based copy-on-update)
- Backup/restore must be frictionless — "scripts so it's frictionless"
- Cloud-ready means: any Mac assumptions that keep us from deploying to cloud/K8s with a command are a problem
- Health check output should be human-readable and immediately actionable

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — greenfield project, no existing code

### Established Patterns
- Phase 1: Docker secrets, compose profiles (dev/prod), named volumes, pg_isready health checks
- Phase 2: Structured JSON stdout logging, MCP TypeScript codebase
- Phase 3: `setup.sh` for secret generation, `scripts/` directory convention

### Integration Points
- Audit logging hooks into MCP server (Phase 2) — MCP writes audit entries on every write operation
- Backup/restore operates on the same `pgdata` named volume (Phase 1)
- Health check verifies all services from Phases 1-3
- `./talos` wrapper complements existing `setup.sh` for operational workflow
- Cloud-readiness audit may require changes to Phase 1 compose if Mac-only assumptions were introduced

</code_context>

<deferred>
## Deferred Ideas

- Container registry publishing (GHCR/Docker Hub) — when OSS distribution matters
- Kubernetes manifests / Helm chart — when there's a K8s deployment target
- WAL archiving for point-in-time recovery — when data volume justifies it
- S3-compatible backup storage — when cloud backup is needed
- Scheduled automatic backups (cron) — could be added to scripts later

</deferred>

---

*Phase: 04-operations*
*Context gathered: 2026-03-27*
