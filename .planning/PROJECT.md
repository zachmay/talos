# Talos

## What This Is

Talos is a self-hosted, Docker-based platform for running agentic AI against a semantically indexed PostgreSQL database. It packages a pgvector-enabled Postgres instance, an MCP server for semantic CRUD operations, and an isolated agent harness into a single repo with docker-compose. Built for personal use but designed clean enough to open-source.

## Core Value

Agents can semantically search, insert, update, and delete data in a secure, self-hosted Postgres database — with zero cloud vendor lock-in and strong isolation between components.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Docker image for Postgres with pgvector extension, pre-configured with RLS enabled by default
- [ ] Semantic search function (match-style cosine similarity with threshold, count, metadata filtering)
- [ ] Docker image for MCP server exposing semantic CRUD: insert with auto-embedding, similarity search, update, delete
- [ ] Provider-agnostic embedding layer — configure any embedding provider (OpenRouter, OpenAI, Anthropic, Ollama, sentence-transformers) via environment variables
- [ ] Docker image for isolated agent harness with strong sandboxing (Nono or equivalent)
- [ ] Main agent prompt with a skill library: declarative references + executable scripts
- [ ] NPM project definition in agent container so `npm install` bootstraps all agent dependencies
- [ ] docker-compose for effortless local startup (`docker compose up` and it works)
- [ ] Controlled credential injection into agent container (no baked-in secrets, env-var or mounted-secret based)
- [ ] Least-privilege networking between containers (agent can reach MCP, MCP can reach DB, agent cannot reach DB directly)
- [ ] Row-level security at DB level with per-agent or per-role policies
- [ ] Audit logging for all write operations against the DB
- [ ] Backup and restore tooling for the DB
- [ ] Cloud-ready Docker images (portable to any container platform)

### Out of Scope

- Supabase dependency — self-hosted Postgres replaces this (validated the pattern in Session 001, now owning the stack)
- Web UI for data browsing — CLI/agent-first, UI can come later
- Multi-tenant SaaS features — single-user/team focus
- Real-time streaming/subscriptions — batch and request/response patterns first

## Context

- **Prior work:** Session 001 validated the core pattern on Supabase: pgvector, RLS with service_role, `match_thoughts` function, OpenRouter for embeddings, MCP integration. Talos self-hosts this entire stack.
- **Embedding dimensions:** Must be configurable (1536 for OpenAI-style, other dimensions for other providers). The provider-agnostic layer handles this.
- **Agent model:** A main agent prompt backed by a skill library. Skills are a mix of reference docs and executable scripts. The agent container is an npm project — `npm install` pulls all dependencies for scripts to run.
- **Security posture:** Security is a first principle, not an afterthought. RLS on by default, least-privilege networking, credential injection via env vars or mounted secrets, strong container isolation via Nono or equivalent, audit trail for writes.

## Constraints

- **Isolation:** Agent container must run with strong sandboxing (Nono or equivalent) — agents may run untrusted code/tools, so isolation is a hard requirement
- **No vendor lock-in:** Embedding provider must be swappable via configuration, not code changes
- **Local-first:** `docker compose up` must get everything running with zero external dependencies beyond Docker itself (local embedding provider as fallback)
- **Portability:** Docker images must be cloud-ready — no Docker-for-Mac-only assumptions

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Self-hosted Postgres over Supabase | Own the full stack, no vendor dependency, control over RLS policies and extensions | — Pending |
| Nono for agent sandboxing | Critical isolation for untrusted agent code/tools | — Pending |
| Provider-agnostic embedding interface | Avoid lock-in, support local inference for air-gapped/offline use | — Pending |
| MCP as the agent-to-DB interface | Standardized protocol, agents never touch DB directly, RLS + MCP = defense in depth | — Pending |
| NPM project for agent skills | Familiar ecosystem, `npm install` bootstraps everything, scripts are just Node | — Pending |

---
*Last updated: 2026-03-27 after initialization*
