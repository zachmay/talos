# Project Research Summary

**Project:** Talos
**Domain:** Self-hosted agentic AI platform with semantic PostgreSQL database
**Researched:** 2026-03-27
**Confidence:** MEDIUM

## Executive Summary

Talos is a self-hosted agent platform that combines structured PostgreSQL storage with semantic vector search, exposed through the Model Context Protocol (MCP). The architecture is fundamentally a three-layer security model: agents interact only with an MCP server that owns all embedding and database logic, and that MCP server is the only component with database credentials. The database enforces row-level security as a second safety net. This layered defense is not optional — it is what makes safe agentic code execution possible when agents run untrusted tool scripts.

The recommended approach is a three-container Docker Compose setup: Postgres 17 + pgvector, a TypeScript MCP server, and a sandboxed agent container. All embedding generation lives in the MCP server (not in the agent), and embedding providers are swappable via environment variables. The critical implementation constraint is that the entire database schema — vector column dimensions, HNSW index, RLS policies with FORCE ROW LEVEL SECURITY, and non-superuser MCP role — must be correct in Phase 1. These foundational elements cannot be safely retrofitted after data exists.

The primary risks are security-related: agent container escape via host volume mounts or Docker socket exposure, RLS bypass through a superuser MCP connection, and embedding dimension mismatch corrupting search silently. All three are addressed by decisions made in Phase 1 (Docker Compose topology, DB schema) and Phase 2 (agent harness hardening). A secondary risk is that Nono's availability on Linux is unverified and must be confirmed before committing to it as the sandbox layer — gVisor is the documented fallback.

## Key Findings

### Recommended Stack

The stack centers on Postgres 17 with pgvector as the combined relational and vector database. Using a unified database for structured and vector data is the right call for Talos's scale — it eliminates inter-service networking for joins, gives atomic transactions across semantic and relational data, and simplifies backups. A separate vector database (Qdrant, Pinecone) is not justified for a self-hosted single-user or small-team product.

The MCP server is TypeScript on Node.js 22 LTS, using the official `@modelcontextprotocol/sdk`. TypeScript is preferred over Python because the agent container is already an NPM project; one language across MCP server and agent means a shared base image and shared type definitions. Raw `pg` (node-postgres) is used instead of an ORM because the MCP server has a small, well-defined query surface where ORM-generated SQL would obscure RLS-relevant behavior.

**Core technologies:**
- **PostgreSQL 17 + pgvector**: Primary data store with vector similarity search — unified DB avoids a separate vector service
- **TypeScript / Node.js 22 LTS**: MCP server runtime — first-party SDK support, shared language with agent container
- **`@modelcontextprotocol/sdk`**: MCP protocol implementation — official Anthropic SDK handles transport and protocol
- **`pg` (node-postgres)**: Database client — parameterized queries, transparent SQL for RLS debugging
- **`zod`**: Schema validation — MCP SDK uses Zod natively; single validation library
- **Docker Compose v2**: Orchestration — `docker compose up` is the stated self-hosted UX requirement
- **Nono (or gVisor fallback)**: Agent sandbox — seccomp and namespace isolation for untrusted code execution

**Versions to validate before use** (all from training data, not live sources): `@modelcontextprotocol/sdk`, `@anthropic-ai/sdk`, `openai`, `@huggingface/transformers`, pgvector image tag, Nono package existence.

### Expected Features

**Must have (table stakes):**
- Semantic search with cosine similarity — core value; pgvector `<=>` operator with configurable threshold and limit
- Insert with auto-embedding — manual embedding is unacceptable developer experience
- Update and delete — basic CRUD completeness; update must re-embed on content change
- `docker compose up` one-command startup — self-hosted product requirement
- Provider-agnostic embedding config — env-var-driven: provider URL, model name, API key, dimensions
- Least-privilege networking — agent to MCP only; MCP to DB only, enforced by Docker network membership
- Row-level security on by default — agents must not access each other's data
- Container isolation/sandboxing — agents run untrusted code; sandbox is not optional
- Credential injection via Docker secrets — API keys must not be readable by agent processes
- Health checks on all containers — operators need observable system state
- Backup and restore scripts — pg_dump/pg_restore with pgvector extension handling

**Should have (competitive differentiators):**
- MCP as the agent-DB interface — standardized protocol; agents from any framework can connect
- Skill library with declarative refs and executable scripts — agents are extensible without image rebuilds
- Local/offline embedding fallback — Ollama or `@huggingface/transformers`; zero cloud dependency mode
- Audit logging on all writes — Postgres trigger-based, with agent ID and operation
- Metadata filtering on semantic search — WHERE clauses combined with vector similarity
- Configurable embedding dimensions — support any model without schema changes
- Structured (JSON) logging on all containers — parseable in production

**Defer to v2+:**
- Per-agent RLS policies — only needed for multi-agent setups; single-agent works with one role
- Real-time streaming/subscriptions — request-response via MCP covers 95% of use cases
- Web UI for data browsing — use pgAdmin externally; UI is a different product
- Cloud deployment guides, Terraform, Helm — images should be portable from day one, but deployment automation comes later
- Plugin marketplace — premature governance overhead

### Architecture Approach

The architecture is a strict three-tier linear pipeline: agent to MCP server to Postgres. The MCP server is the only security boundary between untrusted agent code and the database. Two Docker networks enforce this physically: `agent-net` (agent + MCP) and `db-net` (MCP + Postgres). The agent container has no route to `db-net`. Embedding generation is a middleware concern owned entirely by the MCP server — the agent sends text, the MCP server produces vectors, the database stores them. The agent never sees or touches embeddings.

**Major components:**
1. **Postgres 17 + pgvector** — data storage, HNSW vector index, RLS enforcement, audit logging triggers
2. **MCP Server (TypeScript)** — semantic CRUD API, auto-embedding on insert/update, provider dispatch, DB credentials holder
3. **Agent Container (Nono-sandboxed)** — executes agent prompts and skill scripts; reaches only the MCP server
4. **Embedding Provider** — external (OpenRouter/OpenAI) or local sidecar (Ollama); called only by MCP server

### Critical Pitfalls

1. **Embedding dimension mismatch corrupts search silently** — Define vector columns with explicit dimensions (`vector(1536)`, not `vector`). Store embedding model name and dimensions in a metadata table; MCP server validates on startup. Switching providers requires an explicit re-embedding migration. Must be addressed in Phase 1 DB schema.

2. **RLS bypass via superuser MCP connection** — MCP server must connect as a non-superuser, non-owner role. Apply `ALTER TABLE ... FORCE ROW LEVEL SECURITY` on every table. Use `SET LOCAL app.agent_id` per transaction for per-agent policy evaluation. Must be addressed in Phase 1 DB setup.

3. **Agent container escape via host volume mounts or Docker socket** — Never mount the Docker socket into the agent container. Production volumes must be named or tmpfs, not host bind mounts. Add `read_only: true`, `no-new-privileges: true`, and drop all capabilities. Must be addressed in Phase 2 agent harness.

4. **Credential leakage through environment variables** — API keys must be Docker secrets (files at `/run/secrets/`) not environment variables, which are readable by any process in the container. The agent container should hold no API keys at all — it reaches all services through MCP. Must be addressed in Phase 1 Docker Compose design.

5. **Missing pgvector HNSW index causes O(n) search** — Create an HNSW index from day one: `CREATE INDEX ... USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64)`. Without it, similarity search is a full table scan that degrades invisibly on small datasets. Must be addressed in Phase 1 DB schema.

## Implications for Roadmap

Based on the feature dependency graph, security model requirements, and pitfall phase assignments, research points to a four-phase structure.

### Phase 1: Foundation — Database, Docker, and Security Model

**Rationale:** All subsequent phases depend on a correct database schema and Docker topology. RLS, vector dimensions, HNSW index, and network segmentation cannot be safely added after the fact. Three of the five critical pitfalls must be prevented here. This phase has no user-visible features but is load-bearing for everything else.

**Delivers:** Running Postgres + pgvector container with correct schema (explicit vector dimensions, HNSW index, RLS with FORCE ROW LEVEL SECURITY, non-superuser MCP role), two-network Docker Compose topology, credential injection via Docker secrets, and a health check on Postgres.

**Addresses:** Least-privilege networking, RLS on by default, credential injection, docker-compose startup

**Avoids:** Pitfalls 1 (dimension mismatch), 2 (RLS bypass), 4 (credential leakage), 5 (missing index), 9 (agent-to-DB direct connection)

### Phase 2: MCP Server — Semantic CRUD API

**Rationale:** Once the database foundation is solid, the MCP server is the core product feature that makes Talos useful. This phase implements the insert-with-embedding and semantic-search tools that are table stakes for agents. The embedding provider abstraction is implemented here, making provider switching safe without data corruption.

**Delivers:** Working MCP server with `semantic_insert` and `semantic_search` tools, embedding provider interface with OpenRouter as default and local fallback, embedding metadata validation on startup, basic MCP authentication (per-agent token), HTTP transport (SSE or Streamable HTTP — not stdio for containerized use).

**Uses:** `@modelcontextprotocol/sdk`, `pg`, `zod`, `openai` npm package (OpenRouter-compatible), `@huggingface/transformers` for local fallback

**Implements:** MCP server component; embedding as middleware concern

**Avoids:** Pitfalls 6 (unauthenticated MCP), 10 (embedding API rate limit failures), 13 (hardcoded similarity threshold), 14 (stdio vs HTTP transport)

### Phase 3: Agent Harness — Sandboxed Execution and Skill Library

**Rationale:** Agent harness requires a working MCP server to connect to. Sandboxing must be validated on Linux before building skill library conventions on top of it — Nono's platform compatibility is an open question that blocks this phase and must be resolved during phase planning.

**Delivers:** Agent container with Nono (or gVisor) sandbox, hardened Docker Compose config (read-only root filesystem, dropped capabilities, no host mounts), skill library conventions (scripts directory, auto-injection into system prompt), full CRUD (update with re-embed, delete), audit logging triggers.

**Implements:** Agent container component; sandboxing; skill library pattern

**Avoids:** Pitfalls 3 (container escape), 8 (sandbox platform incompatibility), 11 (skill scripts assuming host environment)

### Phase 4: Operations — Observability and Resilience

**Rationale:** Once the core platform works end-to-end, operational concerns become the quality bar for a self-hosted product people can actually run in production. These features are independent of each other and can be parallelized within the phase.

**Delivers:** Backup and restore scripts with full restore-cycle testing (including pgvector extension pre-installation), structured JSON logging on all containers, health checks on MCP server and agent containers, metadata filtering on semantic search, audit log partitioning by month with retention policy.

**Avoids:** Pitfalls 7 (backup restore failures), 12 (audit log unbounded growth)

### Phase Ordering Rationale

- Phase 1 before Phase 2: The MCP server cannot safely connect to a database without RLS and dimension constraints. Building MCP on an insecure or incorrectly-typed database foundation requires schema migration under live data.
- Phase 2 before Phase 3: The agent harness needs a working MCP server to connect to. There is no way to test the agent sandbox without the tool layer it calls.
- Phase 3 before Phase 4: Operations tooling (backup/restore, log management) can only be validated against a complete system.
- Features are grouped by the component they live in (DB, MCP server, agent harness) rather than by feature type — this matches the codebase structure and reduces context-switching during implementation.

### Research Flags

Phases likely needing deeper research during planning:

- **Phase 3 (Agent Harness):** Nono's availability, npm package name, and Linux platform compatibility are unverified (LOW confidence in STACK.md). Must be resolved before Phase 3 planning. If Nono is unavailable, gVisor integration with Docker Compose needs detailed research.
- **Phase 2 (MCP Server):** MCP SDK transport options (SSE vs Streamable HTTP) are evolving. The current recommended transport for container-to-container MCP should be verified against live SDK documentation before implementation.

Phases with standard patterns (skip research-phase):

- **Phase 1 (Database/Docker):** PostgreSQL RLS, pgvector HNSW indexing, and Docker Compose multi-network patterns are well-documented with stable APIs. Follow the prescriptions in PITFALLS.md directly.
- **Phase 4 (Operations):** pg_dump/pg_restore, Docker health checks, and structured logging are all standard patterns with extensive documentation.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM | Core choices (Postgres, TypeScript, Docker Compose) are HIGH confidence. Package versions are LOW — training data only, must be validated with `npm view`. Nono package is LOW — unverified existence. |
| Features | MEDIUM | Feature categorization is well-reasoned from project context and domain knowledge, but not validated against current competitor landscape. Differentiator claims should be checked against Weaviate, Qdrant, and LangChain-based platforms. |
| Architecture | HIGH | Three-tier architecture with network segmentation is a standard, well-documented pattern. Component boundaries and data flow are unambiguous given the security requirements. |
| Pitfalls | MEDIUM | pgvector, RLS, and Docker security pitfalls are from official sources and are HIGH confidence. Nono-specific pitfalls are inferred from general container sandbox knowledge. |

**Overall confidence:** MEDIUM — sufficient to build a well-structured roadmap. Version pins and Nono availability need live validation before implementation begins.

### Gaps to Address

- **Nono package availability:** Verify `npm view nono` or equivalent before Phase 3. If unavailable, confirm gVisor `runsc` works with Docker Desktop on Mac (development) and Linux (production). This is a Phase 3 blocker.
- **MCP SDK transport:** Confirm current recommended transport for container-to-container MCP communication in the SDK documentation. SSE vs Streamable HTTP has implications for Phase 2 MCP server design.
- **Package versions:** All npm package versions in STACK.md are from training data. Run `npm view <pkg> version` for all packages before creating `package.json`. Mismatched versions between SDK and dependencies are a common source of early friction.
- **Competitor validation:** Feature differentiator claims (MCP as agent-DB interface, local embedding fallback) should be checked against current Weaviate, Qdrant Cloud, and Supabase pgvector offerings before marketing language is finalized.

## Sources

### Primary (HIGH confidence)
- PostgreSQL RLS documentation: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- pgvector GitHub (indexing): https://github.com/pgvector/pgvector
- MCP specification: https://modelcontextprotocol.io
- MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
- Docker Compose networking: https://docs.docker.com/reference/compose-file/services/
- node-postgres: https://node-postgres.com
- Project context: `.planning/PROJECT.md` — validated requirements from Session 001

### Secondary (MEDIUM confidence)
- Domain knowledge of agentic AI platform patterns and self-hosted database tooling (training data)

### Tertiary (LOW confidence)
- All npm package versions — training data only, requires live validation
- Nono sandbox tool — unverified package name, availability, and platform support
- Competitor feature landscape — not checked against live products

---
*Research completed: 2026-03-27*
*Ready for roadmap: yes*
