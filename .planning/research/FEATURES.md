# Feature Landscape

**Domain:** Self-hosted agentic AI platform with semantic PostgreSQL
**Researched:** 2026-03-27
**Confidence:** MEDIUM (based on training data and project context; web search unavailable)

## Table Stakes

Features users expect. Missing = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Semantic search (cosine similarity) | Core value prop -- agents need to find related data | Medium | pgvector `<=>` operator, configurable threshold + limit + metadata filters |
| Insert with auto-embedding | Manual embedding is unacceptable DX | Medium | MCP tool calls `embed()` before insert transparently |
| Update and delete operations | Basic CRUD completeness | Low | Standard SQL through MCP, re-embed on content update |
| docker-compose one-command startup | Self-hosted = must be trivial to run | Medium | `docker compose up` with health checks, dependency ordering |
| Provider-agnostic embedding config | Users have different providers/budgets | Medium | Env-var-driven: provider URL, model name, API key, dimensions |
| Credential injection (not baked-in) | Security baseline for any agent platform | Low | Env vars or Docker secrets mounted at runtime |
| Least-privilege networking | Agents run untrusted code; DB exposure = game over | Low | Docker network policies: agent->MCP only, MCP->DB only |
| Row-level security on by default | Defense in depth; agents must not access other agents' data | Medium | Postgres RLS policies keyed on role/agent ID passed via MCP |
| Container isolation / sandboxing | Agents execute arbitrary code; no sandbox = host compromise | High | Nono or gVisor; must restrict syscalls, filesystem, network |
| Backup and restore | Data loss = trust loss for any database product | Low | pg_dump/pg_restore scripts, cron-friendly, volume snapshots |
| Health checks and readiness probes | Operators need to know if system is functional | Low | Postgres, MCP server, agent harness each expose health endpoints |
| Configuration documentation | Self-hosted users must understand what to configure | Low | Env var reference, example .env, commented docker-compose |

## Differentiators

Features that set product apart. Not expected, but valued.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| MCP protocol as the agent-DB interface | Standardized, composable -- agents from any framework can connect | Medium | MCP is emerging standard; most platforms use proprietary APIs |
| Skill library (declarative refs + executable scripts) | Agents are extensible without rebuilding images | Medium | Convention-over-configuration: drop a script, agent discovers it |
| Local/offline embedding fallback | Air-gapped operation, zero cloud dependency | Medium | sentence-transformers or Ollama as local provider option |
| Audit logging for all writes | Compliance, debugging, trust -- most self-hosted tools skip this | Medium | Postgres trigger-based audit table with agent ID, timestamp, operation, before/after |
| Configurable embedding dimensions | Support any model (1536 OpenAI, 768 BERT, 384 MiniLM, etc.) | Low | Schema migration or init-time column definition |
| Cloud-ready images (portable) | Graduate from laptop to cloud without rearchitecting | Low | Multi-arch builds, no Docker-for-Mac assumptions, env-driven config |
| Metadata filtering on semantic search | Narrow search by tags, timestamps, categories -- not just similarity | Low | WHERE clauses combined with vector similarity |
| Agent prompt templating with skill injection | Main prompt auto-discovers available skills | Low | Convention: skills directory scanned at startup, injected into system prompt |
| Per-agent RLS policies | Multi-agent setups where agents have scoped data access | High | Postgres roles per agent, RLS policies per role |
| Structured logging (JSON) | Operability in production; grep-friendly, parseable | Low | All containers log JSON to stdout |

## Anti-Features

Features to explicitly NOT build.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Web UI for data browsing | Scope creep; CLI/agent-first philosophy; UI is a separate product | Expose data via MCP tools; use pgAdmin or DBeaver if humans need to browse |
| Multi-tenant SaaS features | Massive complexity (billing, auth, tenant isolation) for a single-user/team tool | RLS scopes to agents, not tenants; multi-tenancy is a different product |
| Real-time streaming/subscriptions | Adds WebSocket infra, state management; batch/request-response covers 95% of use cases | Request-response via MCP; add LISTEN/NOTIFY later if validated |
| Built-in LLM hosting | Embedding hosting (Ollama) is fine; full LLM serving is a different problem | Point agents at external LLM APIs (OpenRouter, OpenAI, Anthropic, local Ollama) |
| GUI agent builder / workflow designer | Visual builders are a product category unto themselves | Declarative skill files + prompt templates; code-first |
| Plugin marketplace or registry | Premature; governance overhead; security risk | Git-based skill sharing; users copy skill files |
| Automatic schema migration for user data | Users own their schema; auto-migration is dangerous | Provide migration tooling/scripts; don't auto-run |

## Feature Dependencies

```
Postgres + pgvector (base)
  -> RLS policies (requires Postgres roles)
  -> Semantic search function (requires pgvector index)
  -> Audit logging triggers (requires Postgres)
  -> Backup/restore scripts (requires Postgres)

Embedding layer (requires provider config)
  -> Insert with auto-embedding (requires embedding layer + Postgres)
  -> Update with re-embedding (requires embedding layer + Postgres)

MCP server (requires Postgres connection + embedding layer)
  -> All CRUD tools (requires MCP server)
  -> Metadata filtering (requires MCP server + schema design)
  -> Audit logging integration (requires MCP server + audit triggers)

Agent harness (requires MCP server connection)
  -> Sandboxing/Nono (requires agent harness)
  -> Skill library (requires agent harness + conventions)
  -> Credential injection (requires agent harness + Docker secrets)

docker-compose (orchestrates all above)
  -> Health checks (requires all containers)
  -> Networking policies (requires docker-compose network config)
```

## MVP Recommendation

Prioritize (Phase 1 -- must work end-to-end):
1. Postgres + pgvector in Docker with RLS enabled
2. Embedding layer with one provider (OpenRouter) + local fallback
3. MCP server with semantic insert + search
4. docker-compose with health checks and networking
5. Credential injection via env vars

Phase 2 -- complete the platform:
1. Full CRUD (update with re-embed, delete)
2. Agent harness with sandboxing
3. Skill library conventions
4. Audit logging
5. Backup/restore

Defer:
- Per-agent RLS policies: Only needed for multi-agent setups; single-agent works with one role
- Cloud deployment tooling: Images should be portable from day one, but deployment guides/Terraform/Helm come later
- Metadata filtering: Useful but not blocking; basic similarity search covers initial use cases

## Sources

- Project context: `.planning/PROJECT.md` (validated requirements from Session 001)
- Domain knowledge: pgvector documentation, MCP protocol specification, Docker networking model
- Confidence note: Web search was unavailable; feature categorization based on training data knowledge of the agentic AI and self-hosted database platform space. Recommend validating differentiator claims against current competitors (Weaviate, Qdrant, LangChain-based platforms, Haystack) in phase-specific research.
