# Roadmap: Talos

## Overview

Talos delivers a self-hosted agentic AI platform in five phases: first a secure Postgres foundation with pgvector and Docker networking, then the MCP server that makes semantic CRUD possible, then the sandboxed agent harness, then operational tooling (backup, audit, portability), and finally explicit privacy and security documentation compliance. Each phase delivers a coherent, testable capability that the next phase depends on.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Database and Docker Foundation** - Postgres with pgvector, RLS, dual-network Docker Compose topology, and credential injection
- [x] **Phase 2: MCP Server** - Semantic CRUD API with provider-agnostic embedding and multi-agent authentication (completed 2026-03-28)
- [x] **Phase 3: Agent Harness** - Sandboxed agent container with skill library and NPM project bootstrapping
- [x] **Phase 4: Operations** - Audit logging, backup/restore tooling, and cloud-ready images (completed 2026-03-28)
- [ ] **Phase 5: Privacy and Compliance** - Explicit documentation and enforcement of privacy and security posture
- [ ] **Phase 6: Text UI Client** - Terminal-based TUI for interactive agent conversations with chat view, input area, and status indicators
- [ ] **Phase 7: Subagent Capability** - Enable agents to spawn and coordinate subagents for parallel and delegated task execution

## Phase Details

### Phase 1: Database and Docker Foundation
**Goal**: A running, secure Postgres+pgvector database inside a Docker Compose topology where networking, credentials, and schema are correct from day one
**Depends on**: Nothing (first phase)
**Requirements**: DB-01, DB-02, DB-03, DB-04, DB-05, DB-06, DB-07, DB-08, DB-09, INF-01, INF-02, INF-03
**Success Criteria** (what must be TRUE):
  1. `docker compose up` starts Postgres with pgvector enabled and all init scripts applied without manual intervention
  2. Semantic search function returns cosine-similar rows filtered by metadata and scoped to a specific agent identity
  3. A connection using the MCP (non-superuser) role cannot read rows belonging to a different agent, even with direct SQL
  4. Agent container network cannot reach the Postgres container (connection refused / timeout), while MCP container can reach both networks
  5. No API keys or secrets appear in Docker image layers, environment variable dumps, or `docker inspect` output -- all credentials are injected via Docker secrets
**Plans**: 3 plans

Plans:
- [ ] 01-01-PLAN.md — Project scaffolding: .gitignore, setup.sh secret generation, stub Dockerfiles
- [ ] 01-02-PLAN.md — Database init scripts: schema, indexes, RLS, match_entries function
- [ ] 01-03-PLAN.md — Docker Compose topology and integration test suite

### Phase 2: MCP Server
**Goal**: A working MCP server that agents can call to insert, search, update, and delete semantic data, with embedding handled transparently
**Depends on**: Phase 1
**Requirements**: MCP-01, MCP-02, MCP-03, MCP-04, MCP-05, MCP-06, MCP-07
**Success Criteria** (what must be TRUE):
  1. An agent can insert text via MCP and retrieve it via semantic search without ever seeing or providing an embedding vector
  2. Switching embedding provider (e.g., OpenAI to Ollama) requires only environment variable changes -- no code changes, no redeployment
  3. Updating content via MCP produces a new embedding automatically; searching for the updated meaning returns the updated row
  4. Each agent identity can only access its own data through MCP -- cross-agent data access is rejected
**Plans**: 7 plans

Plans:
- [ ] 02-01-PLAN.md — Project scaffold: package.json, tsconfig, vitest config, and 7 failing test stubs (Wave 0)
- [ ] 02-02-PLAN.md — Infrastructure core: auth middleware (MCP-07), DB wrapper with withAgent(), text chunker
- [ ] 02-03-PLAN.md — Embedding provider layer: EmbeddingProvider interface + factory + 4 adapters (MCP-05, MCP-06)
- [ ] 02-04-PLAN.md — Insert and search tool handlers (MCP-01, MCP-02)
- [ ] 02-05-PLAN.md — Update and delete tool handlers (MCP-03, MCP-04)
- [ ] 02-06-PLAN.md — MCP server wiring, prompts, Dockerfile, docker-compose integration
- [ ] 02-07-PLAN.md — Gap closure: fix agentId for update/delete tools, fix tsconfig rootDir conflict

### Phase 3: Agent Harness
**Goal**: Agents run in a sandboxed container with a skill library and can interact with the database exclusively through MCP
**Depends on**: Phase 2
**Requirements**: AGT-01, AGT-02, AGT-03, AGT-04
**Success Criteria** (what must be TRUE):
  1. Agent container runs with sandbox isolation (Nono or gVisor) -- attempting to escape the sandbox (e.g., accessing host filesystem, spawning privileged processes) fails
  2. `npm install` inside the agent container installs all skill dependencies without errors
  3. Agent prompt loads with skill library references injected, and agent can execute a skill script that calls MCP tools successfully
**Plans**: 4 plans

Plans:
- [ ] 03-01-PLAN.md — Wave 0 scaffold: npm project, jest config, failing test stubs, sandbox smoke test
- [ ] 03-02-PLAN.md — Agent Dockerfiles (base + providers), seccomp profile, compose service with standard sandbox
- [ ] 03-03-PLAN.md — Agent runtime: skill loading, entrypoint, Claude agentic loop with MCP connector
- [ ] 03-04-PLAN.md — MCP fetch tool, base-agent profile (AGENT.md + example-skill), setup.sh agent secrets

### Phase 4: Operations
**Goal**: The platform is production-ready with audit trails, reliable backups, and portable images
**Depends on**: Phase 3
**Requirements**: INF-04, INF-05, INF-06
**Success Criteria** (what must be TRUE):
  1. Every write operation (insert, update, delete) through MCP produces an audit log entry with agent identity, operation type, and timestamp
  2. A full backup-and-restore cycle produces an identical, working database -- semantic search returns the same results before and after restore
  3. Docker images build and run on Linux without Docker-for-Mac-only assumptions (no host.docker.internal, no Mac-only volume behavior)
**Plans**: 3 plans

Plans:
- [ ] 04-01-PLAN.md — Audit log schema (db/init/05-audit.sql) and MCP withAudit() middleware for insert/update/delete
- [ ] 04-02-PLAN.md — Backup and restore scripts (backup.sh, restore.sh) with auto-verification
- [ ] 04-03-PLAN.md — talos CLI wrapper, audit/health/status scripts, and compose portability audit

### Phase 5: Privacy and Compliance
**Goal**: Operators have full visibility into the platform's external communications and security posture
**Depends on**: Phase 4
**Requirements**: PRV-01, PRV-02, PRV-03
**Success Criteria** (what must be TRUE):
  1. All external network callouts (embedding APIs, any cloud service) are documented in a single, discoverable location that operators can review before deployment
  2. The platform provides a clear runtime indication of whether any container is exposed to public or uncontrolled networks
  3. Any security or privacy assumption that is unresolved is tracked as a blocking issue in project documentation
**Plans**: 3 plans

Plans:
- [ ] 05-01-PLAN.md — SECURITY.md: threat model, data flow diagram, security guarantees (CHECK tags), callout inventory, open questions
- [ ] 05-02-PLAN.md — scripts/security-audit.sh: 12 CHECK tag functions + ./talos security-audit routing
- [ ] 05-03-PLAN.md — scripts/network-audit.sh + health.sh Network Posture section + ./talos network-audit routing

### Phase 6: Text UI Client
**Goal**: Terminal-based text UI for interactive agent conversations — chat view, input area, and status indicators replacing raw CLI prompt
**Depends on**: Phase 5
**Requirements**: TUI-01 through TUI-10
**Plans**: 6 plans

Plans:
- [ ] 06-01-PLAN.md — shared/types.ts SSE contract + tui/ package scaffold with SSE parser and tests
- [ ] 06-02-PLAN.md — claude.ts streaming refactor: AsyncGenerator AgentEvent stream + backward-compat wrapper
- [ ] 06-03-PLAN.md — Agent HTTP server: Express SSE endpoint, auth, session guard, /btw queue
- [ ] 06-04-PLAN.md — Ink TUI components: full app.tsx + 7 components + 3 hooks + markdown lib
- [ ] 06-05-PLAN.md — Infrastructure wiring: docker-compose port 3001, tui_token secret, setup.sh
- [ ] 06-06-PLAN.md — ./talos chat subcommand + human end-to-end verification

### Phase 7: Subagent Capability
**Goal**: Enable agents to spawn and coordinate subagents for parallel and delegated task execution
**Depends on**: Phase 6
**Requirements**: SUB-01, SUB-02, SUB-03, SUB-04, SUB-05
**Success Criteria** (what must be TRUE):
  1. Parent agent can call spawn_subagent with a profile name and task; subagent executes independently and returns a result
  2. collect_results blocks until all active subagents complete (or batch timeout); partial failures return per-subagent errors without canceling siblings
  3. Profile AGENT.md frontmatter controls model, token budget, and tool allowlist per subagent — subagents cannot exceed their declared capability
  4. Subagents do not have spawn_subagent available (no nesting by default)
  5. ./talos profiles displays a table of all discoverable profiles with model, token budget, and tool access
**Plans**: 7 plans

Plans:
- [ ] 07-01-PLAN.md — Wave 0 test scaffold: failing stubs for local-tools, conversation-manager, prompt.ts extensions
- [ ] 07-02-PLAN.md — local-tools.ts: LocalToolRegistry + createSpawnHandler + createCollectHandler
- [ ] 07-03-PLAN.md — prompt.ts extension: discoverProfiles, buildSubagentGuidance, ProfileDef; base-agent frontmatter
- [ ] 07-04-PLAN.md — agent.ts + claude.ts: AgentLoopOptions, local tool intercept, model/token/allowlist overrides
- [ ] 07-05-PLAN.md — conversation-manager.ts: ConversationManager with profile registry, subagent batch, token rollup
- [ ] 07-06-PLAN.md — entrypoint.ts refactor: delegates all state to ConversationManager
- [ ] 07-07-PLAN.md — Bundled profiles (research-agent, worker-agent) + compose mounts + ./talos profiles CLI

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Database and Docker Foundation | 0/3 | Not started | - |
| 2. MCP Server | 7/7 | Complete   | 2026-03-28 |
| 3. Agent Harness | 4/4 | Complete   | 2026-03-28 |
| 4. Operations | 3/3 | Complete   | 2026-03-28 |
| 5. Privacy and Compliance | 1/3 | In Progress|  |
| 6. Text UI Client | 5/6 | In Progress|  |
| 7. Subagent Capability | 0/7 | Not started | - |
