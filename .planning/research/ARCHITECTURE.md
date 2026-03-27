# Architecture Patterns

**Domain:** Self-hosted agentic AI platform with semantic database
**Researched:** 2026-03-27

## Recommended Architecture

Three-container architecture with strict network segmentation:

```
                    +------------------+
                    |  Agent Container |
                    |  (Nono sandbox)  |
                    +--------+---------+
                             |
                      MCP protocol (HTTP/SSE)
                             |
                    +--------v---------+
                    |   MCP Server     |
                    | (semantic CRUD)  |
                    +--------+---------+
                             |
                      SQL over TCP/5432
                             |
                    +--------v---------+
                    | Postgres+pgvector|
                    |  (RLS enforced)  |
                    +------------------+
```

### Component Boundaries

| Component | Responsibility | Communicates With | Isolation Level |
|-----------|---------------|-------------------|-----------------|
| **Postgres + pgvector** | Data storage, vector similarity search, RLS enforcement, audit logging | MCP Server only | Docker network: `db-net` only |
| **MCP Server** | Semantic CRUD API, auto-embedding on insert/update, provider-agnostic embedding dispatch | Postgres (downstream), Agent (upstream), Embedding provider (outbound HTTPS) | Docker network: bridges `db-net` and `agent-net` |
| **Agent Container** | Runs agent prompts, skill scripts, untrusted code | MCP Server only | Nono sandbox, `agent-net` only, no direct DB access |
| **Embedding Provider** | Converts text to vectors | Called by MCP Server | External service or local sidecar (Ollama) |

### Network Segmentation (docker-compose networks)

```
db-net:      postgres <-> mcp-server
agent-net:   mcp-server <-> agent
```

The agent container has NO access to `db-net`. This is the primary security boundary. MCP server bridges both networks.

### Data Flow

**Write path (agent inserts a thought):**
1. Agent calls MCP tool `semantic_insert` with text + metadata
2. MCP Server receives request, calls embedding provider to vectorize text
3. MCP Server inserts row (text, embedding vector, metadata) into Postgres via parameterized SQL
4. Postgres RLS policy checks agent role, permits/denies
5. Postgres trigger writes audit log entry
6. MCP Server returns success/failure to agent

**Read path (agent searches semantically):**
1. Agent calls MCP tool `semantic_search` with query text, threshold, limit, optional metadata filter
2. MCP Server embeds the query text via embedding provider
3. MCP Server calls `match_documents(query_embedding, threshold, count, filter)` SQL function
4. Postgres performs cosine similarity via pgvector `<=>` operator, applies RLS, returns ranked results
5. MCP Server returns results to agent

**Embedding provider swap:** Only the MCP Server touches embeddings. Swap provider by changing env vars on MCP Server container. No other component changes.

## Patterns to Follow

### Pattern 1: MCP as Security Boundary
**What:** All agent-to-data access goes through MCP tools. The MCP server is the only component with DB credentials.
**When:** Always. This is non-negotiable for the security model.
**Why:** Defense in depth -- even if agent sandbox is compromised, attacker only gets MCP tool access, not raw SQL.

### Pattern 2: Embedding as Middleware Concern
**What:** The MCP server owns embedding generation. Neither the agent nor the database knows about embedding providers.
**When:** On every insert and every search query.
**Example:**
```typescript
// mcp-server/src/embedding.ts
interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  dimensions: number;
}

// Selected by env var EMBEDDING_PROVIDER
function createProvider(config: ProviderConfig): EmbeddingProvider {
  switch (config.provider) {
    case 'openai': return new OpenAIProvider(config);
    case 'openrouter': return new OpenRouterProvider(config);
    case 'ollama': return new OllamaProvider(config);
    // etc.
  }
}
```

### Pattern 3: Database-Level RLS, Not Application-Level Auth
**What:** Row-level security policies in Postgres enforce access control. MCP server connects with a scoped role, not superuser.
**When:** All queries. RLS is always on.
**Why:** Even if MCP server has a bug, Postgres enforces the policy. Defense in depth again.

### Pattern 4: Sidecar Pattern for Local Embeddings
**What:** For offline/air-gapped use, run Ollama as a fourth container in docker-compose. MCP server calls it on the internal network.
**When:** `EMBEDDING_PROVIDER=ollama` in env.
**Why:** Satisfies the "zero external dependencies" constraint while keeping the same interface.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Agent Direct DB Access
**What:** Giving the agent container a database connection string.
**Why bad:** Agents run untrusted code. Direct SQL access means prompt injection = data exfiltration/destruction.
**Instead:** All DB access through MCP tools with constrained operations.

### Anti-Pattern 2: Embedding in the Agent Container
**What:** Having the agent generate embeddings and pass vectors to MCP.
**Why bad:** Agent could send crafted vectors to manipulate search results. Also couples agent to embedding provider.
**Instead:** Agent sends text, MCP server generates embeddings server-side.

### Anti-Pattern 3: Shared Docker Network
**What:** Putting all containers on one network for simplicity.
**Why bad:** Agent can reach Postgres directly, bypassing MCP + RLS.
**Instead:** Two networks with MCP server bridging them.

### Anti-Pattern 4: Superuser DB Connection
**What:** MCP server connecting as postgres superuser.
**Why bad:** Bypasses RLS. A bug in MCP server = full DB access.
**Instead:** Create a dedicated `mcp_service` role with specific grants. RLS applies to this role.

## Scalability Considerations

| Concern | Single User (now) | Team (10 agents) | Production (100+ agents) |
|---------|-------------------|-------------------|--------------------------|
| **DB connections** | Single connection fine | Connection pooling via PgBouncer sidecar | PgBouncer required, read replicas |
| **Embedding latency** | Inline in request path | Inline still fine | Consider async embedding queue |
| **Vector index** | IVFFlat sufficient | IVFFlat fine | HNSW index, partitioning by namespace |
| **Agent isolation** | Single Nono container | Multiple agent containers, one per task | Kubernetes pods, resource limits |

Not relevant now -- build for single user, design interfaces that don't prevent scaling.

## Sources

- pgvector documentation (verified via prior session context in PROJECT.md)
- MCP protocol specification (Model Context Protocol by Anthropic)
- Docker Compose networking documentation (multi-network bridge pattern)
- PostgreSQL RLS documentation
- Architecture patterns derived from PROJECT.md requirements and validated Session 001 learnings
