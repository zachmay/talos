# Requirements: Talos

**Defined:** 2026-03-27
**Core Value:** Agents can semantically search, insert, update, and delete data in a secure, self-hosted Postgres database — with zero vendor lock-in and strong isolation between components.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Database

- [ ] **DB-01**: Postgres Docker image with pgvector extension pre-installed and enabled
- [ ] **DB-02**: Vector column dimensions configurable via environment variable (not hardcoded)
- [ ] **DB-03**: HNSW index on vector columns for fast approximate nearest-neighbor search
- [ ] **DB-04**: GIN index on JSONB metadata columns for fast filtering
- [ ] **DB-05**: RLS enabled with `FORCE ROW LEVEL SECURITY` on all data tables
- [ ] **DB-06**: Non-superuser role for MCP server connections
- [ ] **DB-07**: Per-agent RLS policies — each agent identity scoped to its own rows only
- [ ] **DB-08**: Semantic search function (cosine similarity with threshold, count, metadata filter, agent-scoped)
- [ ] **DB-09**: Auto-updated timestamp trigger on modified rows

### MCP Server

- [ ] **MCP-01**: Insert operation with automatic embedding generation
- [ ] **MCP-02**: Similarity search with threshold, count, and metadata filtering
- [ ] **MCP-03**: Update operation (content + re-embed)
- [ ] **MCP-04**: Delete operation
- [ ] **MCP-05**: Provider-agnostic embedding interface — swap provider via env vars
- [ ] **MCP-06**: Embedding generation owned by MCP server (agents never call providers directly)
- [ ] **MCP-07**: Multi-agent support — MCP authenticates each agent and passes identity to DB for RLS

### Agent Harness

- [ ] **AGT-01**: Sandboxed container with strong isolation (Nono/gVisor)
- [ ] **AGT-02**: Main agent prompt definition
- [ ] **AGT-03**: Skill library — declarative references plus executable scripts
- [ ] **AGT-04**: NPM project — `npm install` bootstraps all agent dependencies

### Infrastructure

- [ ] **INF-01**: docker-compose for one-command local startup
- [ ] **INF-02**: Dual-network topology — agent↔MCP and MCP↔DB, agent cannot reach DB
- [ ] **INF-03**: Credential injection via Docker secrets or env vars (no baked-in secrets)
- [ ] **INF-04**: Audit logging for all write operations
- [ ] **INF-05**: Backup and restore tooling for the DB
- [ ] **INF-06**: Cloud-ready portable Docker images

### Privacy & Security

- [ ] **PRV-01**: All external callouts (embedding APIs, cloud services) explicitly documented and visible to operator
- [ ] **PRV-02**: Any assumption impacting privacy or security is a blocking issue until documented and resolved
- [ ] **PRV-03**: Operator knows at all times whether infrastructure is exposed to public/uncontrolled resources

## v2 Requirements

### Database

- **DB-V2-01**: History-table versioning with trigger-based copy-on-update (only current docs vector-indexed)

### Agent Harness

- **AGT-V2-01**: Write approval flow — operator can approve/reject individual agent mutations before commit

## Out of Scope

| Feature | Reason |
|---------|--------|
| Supabase dependency | Self-hosted Postgres replaces this — pattern validated in Session 001 |
| Web UI for data browsing | CLI/agent-first, UI can come later |
| Multi-tenant SaaS features | Single-user/team focus |
| Real-time streaming/subscriptions | Batch and request/response patterns first |
| Built-in LLM hosting | Out of scope — agents call external or local LLMs |
| GUI workflow builder | Agents are code/config defined, not drag-and-drop |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| — | — | Pending |

**Coverage:**
- v1 requirements: 23 total
- Mapped to phases: 0
- Unmapped: 23 ⚠️

---
*Requirements defined: 2026-03-27*
*Last updated: 2026-03-27 after initial definition*
