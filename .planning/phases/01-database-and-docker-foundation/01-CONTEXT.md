# Phase 1: Database and Docker Foundation - Context

**Gathered:** 2026-03-27
**Status:** Ready for planning

<domain>
## Phase Boundary

A running, secure Postgres+pgvector database inside a Docker Compose topology where networking, credentials, and schema are correct from day one. Covers DB-01 through DB-09, INF-01, INF-02, INF-03.

</domain>

<decisions>
## Implementation Decisions

### Schema Design
- Two-table model: `entries` (content/metadata) + `chunks` (windowed embeddings)
  - `entries`: id (UUIDv4), content (TEXT, full document), metadata (JSONB), agent_id (TEXT), created_at, updated_at
  - `chunks`: id (UUIDv4), entry_id (FK → entries), chunk_idx (INT), chunk_text (TEXT), embedding (VECTOR), agent_id (TEXT, denormalized for RLS)
- MCP auto-chunks large content into overlapping windows, each chunk gets its own embedding row
- Small documents still get chunked (single chunk) — uniform model, no special cases
- Freeform metadata JSONB on entries — no enforced keys, GIN-indexed for any-key filtering
- Agent identity via session variable: MCP sets `app.agent_id` before each query, RLS policies check `current_setting('app.agent_id')` — applied to BOTH tables
- Path array in metadata for filesystem-like hierarchy: `path: ['tasks', 'home', 'mow the yard.md']`
  - Path is optional — docs without it are flat, searchable by content/metadata only
  - Supported operations: exact path match, prefix/subtree listing, depth-limited listing (direct children only)
- Cosine similarity only for distance metric
- Containment (`@>`) for general metadata filtering + array operators for path hierarchy queries
- Semantic search function searches chunks, joins to entries to return full content
- Semantic search supports path-scoped queries (narrow by subtree via entries metadata, then rank chunks by similarity)
- Table names: `entries` + `chunks`, DB function: `match_entries` (searches chunks, returns entries)
- HNSW index on chunks.embedding, GIN index on entries.metadata
- MCP tool names should be minimal to save tokens (e.g., `search`, `insert`, `update`, `delete`) — Phase 2 concern but noted here

### Init & Bootstrap
- Raw SQL init scripts in `docker-entrypoint-initdb.d/` directory, numbered for execution order
- Optional dev seed script (not auto-run) for development data
- Base image: `pgvector/pgvector:pg17`
- Vector dimensions set at init time via `VECTOR_DIMENSIONS` env var (default 1536)
- Note for later: implement a script to change dimensions and do automated reindex

### Credential & Secrets Flow
- Docker secrets only — mounted at `/run/secrets/`, nothing in env vars or image layers
- Bash `setup.sh` generates all secrets (DB passwords + embedding API key placeholders for Phase 2)
- Idempotent: skips existing secret files on re-run
- `secrets/` directory gitignored, `secrets.example/` with placeholder files committed
- Two DB roles: `postgres` (superuser, init/admin only) and `mcp_service` (limited DML + EXECUTE, RLS enforced)

### Container & Network Layout
- Two named networks: `backend` (MCP<->DB) and `frontend` (agent<->MCP)
- DB only on backend, MCP on both, agent only on frontend
- DB port 5432 exposed to host for dev only (via compose profiles)
- Named Docker volume (`pgdata`) for Postgres data persistence
- `pg_isready` health check on DB; MCP depends on `service_healthy`
- Stub MCP and agent services (alpine + sleep) included in Phase 1 for network topology testing
- Service-based directory structure: `db/`, `mcp/`, `agent/`, `scripts/`
- Docker Compose profiles: dev (default, exposes DB port) and prod (fully internal)
- Short service names: `db`, `mcp`, `agent`

### Claude's Discretion
- Exact SQL for init scripts (extension setup, schema, functions, RLS policies, triggers)
- HNSW index parameters (ef_construction, m)
- Health check intervals and retry counts
- setup.sh password generation method (openssl rand or similar)
- Dev seed script content and structure

</decisions>

<specifics>
## Specific Ideas

- Path array pattern inspired by filesystem metaphor: agents organize data like files in directories
- "Minimize MCP operation names to save tokens" — keep tool names short
- Setup script should prompt for embedding API keys upfront (even though Phase 2 uses them) so users only run setup once
- Dimension change script noted as future utility — not in Phase 1 scope but captured for backlog

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — greenfield project, no existing code

### Established Patterns
- Prior art: Session 001 validated pgvector + RLS + `match_thoughts` on Supabase. This phase self-hosts the same pattern.
- Embedding dimensions must be configurable (1536 default for OpenAI-style)

### Integration Points
- MCP server (Phase 2) connects as `mcp_service` role to backend network
- Agent harness (Phase 3) connects to frontend network, reaches MCP only
- setup.sh creates secrets consumed by all services across phases

</code_context>

<deferred>
## Deferred Ideas

- Dimension change/reindex script — utility for when embedding provider changes (backlog)
- MCP tool naming conventions — Phase 2
- Embedding provider API key usage — Phase 2

</deferred>

---

*Phase: 01-database-and-docker-foundation*
*Context gathered: 2026-03-27*
