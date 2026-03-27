# Phase 2: MCP Server - Context

**Gathered:** 2026-03-27
**Status:** Ready for planning

<domain>
## Phase Boundary

A working MCP server that agents can call to insert, search, update, and delete semantic data, with embedding handled transparently and multi-agent authentication. Covers MCP-01 through MCP-07.

</domain>

<decisions>
## Implementation Decisions

### Tool Interface Design
- Progressive discovery: 4 core tools always visible (`insert`, `search`, `update`, `delete`), MCP prompts reveal advanced capabilities on demand
  - Prompts like "path-operations", "advanced-search", "bulk-operations" teach agents deeper features
  - Prompts defined statically in TypeScript source, version-controlled
- Core tools have optional advanced parameters — basic usage is simple, advanced params discoverable via prompts
  - `search`: requires `query` (string); optional `path`, `filter`, `threshold`, `count`, `depth`
  - If only `path` provided (no query), acts as path listing (ls-style)
  - If both query + path, does path-scoped semantic search
- Minimal responses by default — return only essential fields (id, content, path). Verbose mode via optional `verbose: true` param adds similarity scores, metadata, timestamps, matched chunk info
- `insert` takes one entry at a time (batch is an advanced/prompt-revealed capability)
- `update` does full content replace + re-embed. Metadata-only updates also supported (no re-embed needed)
- Built in TypeScript using MCP SDK
- Transport: Streamable HTTP (current MCP standard)

### Embedding Provider Layer
- Adapter pattern: common `EmbeddingProvider` interface with per-provider adapters
- `EMBEDDING_PROVIDER` env var selects adapter; `EMBEDDING_MODEL` and `EMBEDDING_API_KEY` configure it
- Supported providers at launch: OpenRouter, OpenAI direct, Ollama (local), Anthropic
- No fallback chain — single provider, fail clearly on error
- No embedding cache — DB stores embeddings, that IS the cache
- Auto-chunking at MCP layer for large documents:
  - Splits content into overlapping windows before embedding
  - Each chunk stored as separate row in `chunks` table, linked to parent `entries` row
  - Server-level defaults via env vars: `CHUNK_SIZE` (chars per window), `CHUNK_OVERLAP` (overlap chars)
  - Overridable per-insert: `chunk_size` and `chunk_overlap` optional params
  - Search hits chunks but returns full entry content by default (verbose mode shows matched chunk)

### Agent Authentication
- API key per agent — each agent gets a unique key, MCP maps key → agent_id, sets `app.agent_id` session variable
- Key-to-agent mapping stored in JSON config file mounted as Docker secret (`secrets/agent_keys.json`)
- `setup.sh` creates a default agent key so the system works out of the box
- Unauthenticated requests rejected entirely (401). Invalid keys get 403.
- Strict agent isolation — each agent sees only its own rows. No shared namespaces, no cross-agent access.
- No per-agent permission scopes in v1 — every authenticated agent gets full CRUD

### Error Handling & Responses
- Structured MCP error responses with code + human-readable message
  - Codes: `AUTH_REQUIRED`, `AUTH_INVALID`, `NOT_FOUND`, `VALIDATION_ERROR`, `EMBEDDING_FAILED`, `DB_ERROR`
- Embedding provider failure = reject the operation (no data stored without embedding)
- Basic input validation: reject empty/whitespace content, enforce max content length (provider token limits)
- Structured JSON logging to stdout (Docker captures)
  - Includes: timestamp, level, request ID, agent_id, operation, result/error, timing (ms)
  - Viewable via `docker compose logs mcp`

### Claude's Discretion
- Exact MCP prompt content and structure
- Internal chunking algorithm (character-based vs token-based splitting)
- DB connection pooling strategy
- Request ID generation method
- Exact validation thresholds (max content length)

</decisions>

<specifics>
## Specific Ideas

- Progressive discovery via MCP prompts — agents start simple, learn advanced features on demand. Keeps base token cost low.
- "Minimize tool names to save tokens" — carried forward from Phase 1 discussion
- Auto-research optimal windowing schemes for processing big docs — future intelligence layer idea
- Session 001's `match_thoughts` function is the spiritual ancestor of `match_entries`

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — greenfield project, no existing code

### Established Patterns
- Session 001 validated: pgvector cosine search, RLS with service_role, OpenRouter for embeddings, metadata JSONB filtering
- Phase 1 establishes: two-table schema (entries + chunks), session variable for agent identity, Docker secrets for credentials

### Integration Points
- Connects to Postgres as `mcp_service` role on `backend` network
- Agent harness (Phase 3) connects to MCP on `frontend` network via Streamable HTTP
- Reads `agent_keys.json` from Docker secrets for authentication
- `setup.sh` (Phase 1) creates embedding API key placeholder and default agent key

</code_context>

<deferred>
## Deferred Ideas

- Auto-optimizing window parameters based on content type — future intelligence layer
- Batch insert as prompt-revealed advanced capability (not core tool)
- Per-agent permission scopes (read-only, read-write, admin) — future version
- Shared data namespace across agents — future version

</deferred>

---

*Phase: 02-mcp-server*
*Context gathered: 2026-03-27*
