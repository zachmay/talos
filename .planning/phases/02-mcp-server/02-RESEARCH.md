# Phase 2: MCP Server - Research

**Researched:** 2026-03-27
**Domain:** MCP TypeScript SDK, Streamable HTTP transport, embedding provider adapter pattern, agent authentication
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Tool Interface Design**
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

**Embedding Provider Layer**
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

**Agent Authentication**
- API key per agent — each agent gets a unique key, MCP maps key → agent_id, sets `app.agent_id` session variable
- Key-to-agent mapping stored in JSON config file mounted as Docker secret (`secrets/agent_keys.json`)
- `setup.sh` creates a default agent key so the system works out of the box
- Unauthenticated requests rejected entirely (401). Invalid keys get 403.
- Strict agent isolation — each agent sees only its own rows. No shared namespaces, no cross-agent access.
- No per-agent permission scopes in v1 — every authenticated agent gets full CRUD

**Error Handling & Responses**
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

### Deferred Ideas (OUT OF SCOPE)
- Auto-optimizing window parameters based on content type — future intelligence layer
- Batch insert as prompt-revealed advanced capability (not core tool)
- Per-agent permission scopes (read-only, read-write, admin) — future version
- Shared data namespace across agents — future version
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MCP-01 | Insert operation with automatic embedding generation | `server.registerTool('insert', ...)` calls embedding provider, chunks content, writes to `entries` + `chunks` tables |
| MCP-02 | Similarity search with threshold, count, and metadata filtering | Tool calls `match_entries` DB function (Phase 1); optional `path`/`filter`/`threshold`/`count` params |
| MCP-03 | Update operation (content + re-embed) | Tool deletes old chunks, re-embeds new content, updates `entries` row; metadata-only path skips re-embed |
| MCP-04 | Delete operation | Tool deletes from `entries` (CASCADE removes chunks); RLS enforces agent-scoped delete |
| MCP-05 | Provider-agnostic embedding interface — swap provider via env vars | `EmbeddingProvider` interface; `EMBEDDING_PROVIDER` env var selects implementation at startup |
| MCP-06 | Embedding generation owned by MCP server (agents never call providers directly) | All embedding calls inside MCP tool handlers; agents only pass text content |
| MCP-07 | Multi-agent support — MCP authenticates each agent and passes identity to DB for RLS | API key → agent_id lookup from `agent_keys.json`; `SET LOCAL app.agent_id = ?` before each query |
</phase_requirements>

---

## Summary

Phase 2 builds a TypeScript MCP server using `@modelcontextprotocol/sdk` v1.x (currently v1.28.0) with Streamable HTTP transport. The MCP SDK is the clear standard — it provides `McpServer`, tool registration with Zod schemas, prompt registration, and `StreamableHTTPServerTransport` out of the box. v1.x is the production-stable branch; v2 is pre-alpha, not for use here.

The embedding adapter pattern is straightforward: define a TypeScript `EmbeddingProvider` interface, implement one class per provider (OpenRouter, OpenAI, Ollama, Anthropic), and select via `EMBEDDING_PROVIDER` env var at startup. The chunking layer sits above the adapter — MCP splits content, calls the provider for each chunk, writes all chunks to the DB in a single transaction.

Agent authentication is custom (not OAuth) — API key in the `Authorization: Bearer <key>` header, mapped to `agent_id` via `agent_keys.json`, then `SET LOCAL app.agent_id = ?` injected into every DB transaction. This works because Phase 1 established RLS policies that check `current_setting('app.agent_id')`.

The key STATE.md concern — "MCP SDK transport (SSE vs Streamable HTTP) should be verified" — is resolved: **Streamable HTTP is confirmed as the current standard** in the MCP spec (2025-06-18). HTTP+SSE was the old transport from protocol version 2024-11-05 and is now deprecated. The `StreamableHTTPServerTransport` class in the SDK implements this correctly.

**Primary recommendation:** Use `McpServer` + `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk` v1.x, with Express as the HTTP layer. Implement tools with Zod input schemas, inject `agent_id` into all DB transactions via `SET LOCAL`, and wrap all embedding calls in the provider adapter so they are swappable.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @modelcontextprotocol/sdk | 1.28.0 | MCP server framework, tool/prompt registration, Streamable HTTP transport | Official Anthropic SDK; only production-stable MCP TypeScript implementation |
| zod | 3.x | Input schema validation for MCP tools | Required peer dep of MCP SDK; used in `registerTool` inputSchema |
| express | 4.x | HTTP server for Streamable HTTP transport | SDK examples use Express; well-supported, minimal overhead |
| pg | 8.x | PostgreSQL client (node-postgres) | Standard Node.js Postgres driver; supports parameterized queries, transaction control |
| typescript | 5.x | Language | Locked by CONTEXT.md |
| tsx or ts-node | latest | TypeScript execution in Docker | No compile step needed for server startup |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| uuid | 9.x | Request ID generation | `crypto.randomUUID()` (Node 14.17+) is built-in — prefer that, uuid as fallback |
| dotenv | 16.x | Env var loading in development | Dev only; Docker passes env vars directly in prod |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Express | Fastify, Hono | Express is used in official SDK examples; Hono is lighter but adds unfamiliarity |
| pg (node-postgres) | postgres.js, Drizzle | pg is the lowest-level, most control over `SET LOCAL` and transaction flow; ORMs hide this |
| tsx | esbuild + docker build | tsx is simpler for a server with no build step; acceptable for this use case |

**Installation:**
```bash
npm install @modelcontextprotocol/sdk zod express pg
npm install --save-dev typescript @types/express @types/pg tsx
```

---

## Architecture Patterns

### Recommended Project Structure

```
mcp/
├── src/
│   ├── server.ts          # McpServer creation + tool/prompt registration
│   ├── transport.ts       # Express + StreamableHTTPServerTransport setup
│   ├── auth.ts            # API key validation, agent_keys.json loading
│   ├── db.ts              # pg Pool creation, query helpers, SET LOCAL wrapper
│   ├── chunker.ts         # Text chunking (overlapping windows)
│   ├── tools/
│   │   ├── insert.ts      # insert tool handler
│   │   ├── search.ts      # search tool handler
│   │   ├── update.ts      # update tool handler
│   │   └── delete.ts      # delete tool handler
│   ├── providers/
│   │   ├── interface.ts   # EmbeddingProvider interface
│   │   ├── openrouter.ts  # OpenRouter adapter
│   │   ├── openai.ts      # OpenAI direct adapter
│   │   ├── ollama.ts      # Ollama (local) adapter
│   │   └── anthropic.ts   # Anthropic adapter
│   └── prompts/
│       ├── path-operations.ts
│       ├── advanced-search.ts
│       └── bulk-operations.ts
├── package.json
├── tsconfig.json
└── Dockerfile
```

### Pattern 1: MCP Server + Tool Registration

**What:** Create an `McpServer` and register tools using Zod schemas. Each tool handler receives validated input and returns `{ content: [{ type: 'text', text: ... }] }`.

**When to use:** Every tool. This is the only supported pattern in the SDK.

```typescript
// Source: modelcontextprotocol.io quickstart + SDK v1.28.0
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const server = new McpServer({ name: "talos-mcp", version: "1.0.0" });

server.registerTool(
  "insert",
  {
    description: "Insert text content with automatic embedding",
    inputSchema: {
      content: z.string().min(1).describe("Text content to store"),
      path: z.array(z.string()).optional().describe("Path hierarchy e.g. ['tasks', 'home']"),
      metadata: z.record(z.unknown()).optional().describe("Arbitrary metadata"),
      chunk_size: z.number().optional().describe("Override default chunk size in chars"),
      chunk_overlap: z.number().optional().describe("Override default chunk overlap in chars"),
      verbose: z.boolean().optional().describe("Return full metadata in response"),
    },
  },
  async ({ content, path, metadata, chunk_size, chunk_overlap, verbose }, extra) => {
    // handler implementation
    return { content: [{ type: "text", text: JSON.stringify({ id, content, path }) }] };
  }
);
```

### Pattern 2: Streamable HTTP Transport with Express

**What:** Use `StreamableHTTPServerTransport` with Express. Handle POST, GET, DELETE on `/mcp`. Sessions stored in a map keyed by `Mcp-Session-Id`.

**When to use:** Always — this is the required transport for the Streamable HTTP standard.

```typescript
// Source: modelcontextprotocol.io/docs/concepts/transports (2025-06-18 spec)
// + SDK v1.x simpleStreamableHttp.ts example
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";

const app = express();
app.use(express.json());
const transports = new Map<string, StreamableHTTPServerTransport>();

app.post("/mcp", authMiddleware, async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  let transport: StreamableHTTPServerTransport;

  if (sessionId && transports.has(sessionId)) {
    transport = transports.get(sessionId)!;
  } else {
    // New session
    transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID() });
    transport.onsessioninitialized = (id) => { transports.set(id, transport); };
    transport.onclose = () => { transports.delete(sessionId!); };
    await server.connect(transport);
  }
  await transport.handleRequest(req, res, req.body);
});

app.get("/mcp", authMiddleware, async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string;
  const transport = transports.get(sessionId);
  if (!transport) { res.status(404).end(); return; }
  await transport.handleRequest(req, res);
});

app.delete("/mcp", authMiddleware, async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string;
  const transport = transports.get(sessionId);
  if (transport) { await transport.close(); transports.delete(sessionId); }
  res.status(200).end();
});
```

**Security requirement (from spec):** Validate the `Origin` header on all incoming connections to prevent DNS rebinding attacks.

### Pattern 3: Authentication Middleware

**What:** Check `Authorization: Bearer <key>` header before routing. Reject unauthenticated (401) and invalid-key (403) requests. Attach `agent_id` to `req` object for downstream handlers.

**When to use:** All three MCP endpoints (POST, GET, DELETE).

```typescript
// Source: design pattern based on CONTEXT.md decisions
import fs from "fs";

interface AgentKeys { [key: string]: string; } // key → agent_id
const agentKeys: AgentKeys = JSON.parse(
  fs.readFileSync("/run/secrets/agent_keys.json", "utf8")
);

function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers["authorization"];
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "AUTH_REQUIRED", message: "Authorization header required" });
    return;
  }
  const key = authHeader.slice(7);
  const agentId = agentKeys[key];
  if (!agentId) {
    res.status(403).json({ error: "AUTH_INVALID", message: "Invalid API key" });
    return;
  }
  (req as any).agentId = agentId;
  next();
}
```

### Pattern 4: Agent-Scoped DB Queries

**What:** Every database operation runs inside a transaction that begins with `SET LOCAL app.agent_id = $1`. This activates the RLS policies established in Phase 1. The session variable is transaction-local and resets automatically when the transaction ends.

**When to use:** Every query that touches `entries` or `chunks`.

```typescript
// Source: Phase 1 CONTEXT.md + Postgres docs on SET LOCAL
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function withAgent<T>(agentId: string, fn: (client: any) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.agent_id', $1, true)", [agentId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
```

### Pattern 5: Embedding Provider Interface

**What:** Define a single `EmbeddingProvider` interface and implement one class per provider. Select at startup via env var.

**When to use:** All embedding calls go through this — never call provider APIs directly from tool handlers.

```typescript
// Source: CONTEXT.md adapter pattern decision
export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  dimensions: number;
}

export function createEmbeddingProvider(): EmbeddingProvider {
  const provider = process.env.EMBEDDING_PROVIDER ?? "openrouter";
  switch (provider) {
    case "openai":     return new OpenAIProvider();
    case "ollama":     return new OllamaProvider();
    case "anthropic":  return new AnthropicProvider();
    case "openrouter":
    default:           return new OpenRouterProvider();
  }
}
```

### Pattern 6: Text Chunking

**What:** Split content into overlapping character windows. Each chunk embedded separately.

**When to use:** All insert and update operations.

```typescript
// Source: CONTEXT.md chunking decisions (character-based is Claude's discretion)
function chunkText(
  text: string,
  chunkSize: number,
  chunkOverlap: number
): string[] {
  if (text.length <= chunkSize) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    if (end === text.length) break;
    start += chunkSize - chunkOverlap;
  }
  return chunks;
}
```

### Pattern 7: MCP Prompts for Progressive Discovery

**What:** Register static prompts that return instructional messages teaching agents about advanced features. Agents call `prompts/get` to retrieve the content.

```typescript
// Source: modelcontextprotocol.io/docs/concepts/prompts
server.registerPrompt(
  "advanced-search",
  {
    description: "Learn advanced search capabilities: path-scoped search, threshold tuning, verbose mode",
    arguments: [],
  },
  async () => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `Advanced search guide:\n- Path-scoped: search({ query: "...", path: ["tasks"] })\n- Threshold: search({ query: "...", threshold: 0.8 })\n- Verbose: search({ query: "...", verbose: true }) returns similarity scores`
      }
    }]
  })
);
```

### Anti-Patterns to Avoid

- **Embedding outside a transaction:** Embedding takes time; never embed then open a transaction — open the transaction first (or embed before, but insert inside one atomic operation per chunk).
- **Using SET (not SET LOCAL) for app.agent_id:** `SET` is session-scoped and persists across requests on the same pooled connection. Must use `SET LOCAL` (transaction-scoped) or `set_config('app.agent_id', $1, true)`.
- **Storing embeddings before content:** If the DB write fails after embedding, the embedding is wasted. Do all work in one transaction: embed all chunks, then write entry + all chunks atomically.
- **Exposing agent_id as a tool parameter:** Agents must never be able to specify their own agent_id. It comes from the authenticated API key only.
- **Returning raw vectors in responses:** Vectors are large; never include them in MCP tool responses.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MCP protocol encoding/decoding | Custom JSON-RPC handler | `@modelcontextprotocol/sdk` | Protocol has initialization lifecycle, capability negotiation, session management — complex to get right |
| Input schema validation | Manual type checks | Zod schemas in `registerTool` | SDK enforces schema before calling handler; safe by default |
| SSE stream management | Custom EventSource/SSE | `StreamableHTTPServerTransport` | Handles resumability, Last-Event-ID, multi-connection per spec |
| Text chunking | Complex NLP splitter | Character-window chunking | Good enough; token-based requires provider-specific tokenizers as external dep |
| DB connection management | Manual connect/disconnect | `pg.Pool` | Pool handles idle connections, reconnect, max connections |

---

## Common Pitfalls

### Pitfall 1: SET vs SET LOCAL for app.agent_id

**What goes wrong:** Using `SET app.agent_id = $1` (session-scoped) with a connection pool means one agent's identity leaks into the next request that reuses the connection.

**Why it happens:** `SET` persists for the life of the connection. Connection pools reuse connections across requests.

**How to avoid:** Always use `set_config('app.agent_id', agentId, true)` (third param `true` = local/transaction-scoped) or `SET LOCAL`. Wrap every DB operation in a transaction.

**Warning signs:** Agents seeing each other's data in tests.

### Pitfall 2: Streamable HTTP Origin Validation

**What goes wrong:** Skipping `Origin` header validation allows DNS rebinding attacks where a malicious website can make requests to the local MCP server appearing to come from localhost.

**Why it happens:** Browsers automatically include the `Origin` header on cross-origin requests. Without validation, any webpage can call the MCP server.

**How to avoid:** The official MCP spec (2025-06-18) explicitly requires servers to validate `Origin` on all incoming connections. Check that the `Origin` header matches expected values or is absent (direct API calls don't send `Origin`).

**Warning signs:** MCP server accepting requests with unexpected `Origin` headers.

### Pitfall 3: Partial Insert on Embedding Failure

**What goes wrong:** Writing the `entries` row to DB before all chunks are embedded. If chunk 3 of 5 fails to embed, the entry exists with missing chunks.

**Why it happens:** Eager insertion — write entry, then embed and write chunks one by one.

**How to avoid:** Embed all chunks first (outside any DB transaction — embedding is idempotent if retried), then open a single transaction and write the `entries` row + all chunk rows atomically. On any embedding failure, reject the operation entirely.

### Pitfall 4: MCP SDK v2 Pre-Alpha Confusion

**What goes wrong:** Pulling from the `main` branch of `typescript-sdk` gets v2 (pre-alpha), which has a different API.

**Why it happens:** GitHub default branch is `main` = v2 in development.

**How to avoid:** Pin to `@modelcontextprotocol/sdk@1.28.0` (or latest `1.x`) in `package.json`. Use the `v1.x` branch examples as reference.

### Pitfall 5: Agent_keys.json Hot Reload

**What goes wrong:** Loading `agent_keys.json` once at startup means new agent keys require a container restart.

**Why it happens:** File is read into memory once.

**How to avoid:** For v1, this is acceptable — document it. The decision is locked: keys live in a Docker secret file. Restart is the expected deployment operation for adding new agents.

### Pitfall 6: Chunking Overlap Larger Than Chunk Size

**What goes wrong:** `CHUNK_OVERLAP >= CHUNK_SIZE` causes infinite loop in chunker.

**Why it happens:** `start += chunkSize - chunkOverlap` never advances if overlap >= size.

**How to avoid:** Validate at startup: `CHUNK_OVERLAP` must be less than `CHUNK_SIZE`. Fail clearly with a descriptive error if misconfigured.

---

## Code Examples

### Embedding Provider: OpenRouter

```typescript
// Source: OpenRouter API docs (openrouter.ai/docs/api-reference/embeddings)
export class OpenRouterProvider implements EmbeddingProvider {
  readonly dimensions: number;
  private model: string;
  private apiKey: string;

  constructor() {
    this.model = process.env.EMBEDDING_MODEL ?? "openai/text-embedding-3-small";
    this.apiKey = process.env.EMBEDDING_API_KEY ?? "";
    this.dimensions = parseInt(process.env.VECTOR_DIMENSIONS ?? "1536", 10);
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
      method: "POST",
      headers: { "Authorization": `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, input: text }),
    });
    if (!res.ok) throw new Error(`EMBEDDING_FAILED: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return data.data[0].embedding;
  }
}
```

### Embedding Provider: Ollama

```typescript
// Source: Ollama API docs (ollama.ai/docs/api#generate-embeddings)
export class OllamaProvider implements EmbeddingProvider {
  readonly dimensions: number;
  private model: string;
  private baseUrl: string;

  constructor() {
    this.model = process.env.EMBEDDING_MODEL ?? "nomic-embed-text";
    this.baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
    this.dimensions = parseInt(process.env.VECTOR_DIMENSIONS ?? "768", 10);
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, prompt: text }),
    });
    if (!res.ok) throw new Error(`EMBEDDING_FAILED: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return data.embedding;
  }
}
```

### Structured JSON Logging

```typescript
// Source: CONTEXT.md logging decisions
function log(level: "info" | "warn" | "error", data: object) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    ...data,
  }));
}

// Usage in tool handler:
log("info", {
  request_id: requestId,
  agent_id: agentId,
  operation: "insert",
  entry_id: id,
  chunks: chunkCount,
  duration_ms: Date.now() - start,
});
```

### Tool Error Response Pattern

```typescript
// Source: MCP spec — isError: true for tool execution errors (not protocol errors)
function toolError(code: string, message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: code, message }) }],
    isError: true,
  };
}

// Usage:
if (!content.trim()) {
  return toolError("VALIDATION_ERROR", "Content must not be empty");
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| HTTP+SSE transport (separate /sse + /messages endpoints) | Streamable HTTP (single /mcp endpoint, POST+GET+DELETE) | MCP spec 2025-03-26 | SSE transport is deprecated; new clients use Streamable HTTP |
| `Server` class + manual tool routing | `McpServer` high-level class with `registerTool` | SDK ~1.5.0 | Simpler API; Zod validation built in |
| stdio-only MCP servers | Streamable HTTP for remote/Docker servers | MCP spec 2024-11-05 → 2025-03-26 | stdio still valid for local process; HTTP required for Docker deployment |

**Deprecated/outdated:**
- HTTP+SSE transport: separate `/sse` GET endpoint + `/messages` POST endpoint — replaced by single `/mcp` endpoint. Do not implement the old SSE transport.
- `@modelcontextprotocol/sdk` v2 (main branch): pre-alpha, API not stable — use v1.x.

---

## Open Questions

1. **Anthropic embedding API availability**
   - What we know: Anthropic offers Claude models; it's unclear if they have a public embeddings endpoint as of research date.
   - What's unclear: Does Anthropic have a REST embeddings API, or does the "Anthropic adapter" need to use a third-party re-export?
   - Recommendation: Mark Anthropic provider as "stub — not verified" in implementation. If no embeddings API exists, remove from supported list in v1 and document clearly. OpenRouter covers Anthropic-compatible models anyway.

2. **Ollama container networking in Docker Compose**
   - What we know: Ollama runs as a separate service, typically on port 11434.
   - What's unclear: Should Ollama be a service inside the compose stack or expected to be running externally?
   - Recommendation: For v1, treat Ollama as external (set `OLLAMA_BASE_URL` env var pointing to host). Adding Ollama as a compose service is a future enhancement.

3. **MCP-Session-Id and multi-agent session isolation**
   - What we know: Session IDs are assigned per client connection; `agent_id` comes from the API key in the `Authorization` header.
   - What's unclear: Can one agent have multiple concurrent sessions? Should session ID be tied to agent_id?
   - Recommendation: Allow multiple sessions per agent — each session gets its own transport. `agent_id` is always from the auth key, not the session. This is the natural behavior of the Streamable HTTP spec.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (or Jest) + Supertest |
| Config file | `mcp/vitest.config.ts` — Wave 0 creates this |
| Quick run command | `cd mcp && npx vitest run --reporter=verbose` |
| Full suite command | `cd mcp && npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MCP-01 | insert tool embeds content and writes entry + chunks | integration | `npx vitest run tests/tools/insert.test.ts` | Wave 0 |
| MCP-02 | search tool calls match_entries and returns results | integration | `npx vitest run tests/tools/search.test.ts` | Wave 0 |
| MCP-03 | update tool re-embeds and replaces chunks | integration | `npx vitest run tests/tools/update.test.ts` | Wave 0 |
| MCP-04 | delete tool removes entry and cascades to chunks | integration | `npx vitest run tests/tools/delete.test.ts` | Wave 0 |
| MCP-05 | EMBEDDING_PROVIDER env var selects correct adapter | unit | `npx vitest run tests/providers/factory.test.ts` | Wave 0 |
| MCP-06 | tool handlers call embed() not provider directly | unit | `npx vitest run tests/providers/interface.test.ts` | Wave 0 |
| MCP-07 | missing key → 401; invalid key → 403; valid key sets agent_id | unit | `npx vitest run tests/auth.test.ts` | Wave 0 |

**Note on integration tests:** MCP-01 through MCP-04 require a live Postgres instance. These tests should use a test DB container or docker compose test profile. Unit tests (MCP-05 through MCP-07) mock all dependencies.

### Sampling Rate

- **Per task commit:** `cd mcp && npx vitest run tests/auth.test.ts tests/providers/factory.test.ts`
- **Per wave merge:** `cd mcp && npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `mcp/tests/auth.test.ts` — covers MCP-07
- [ ] `mcp/tests/providers/factory.test.ts` — covers MCP-05
- [ ] `mcp/tests/providers/interface.test.ts` — covers MCP-06
- [ ] `mcp/tests/tools/insert.test.ts` — covers MCP-01
- [ ] `mcp/tests/tools/search.test.ts` — covers MCP-02
- [ ] `mcp/tests/tools/update.test.ts` — covers MCP-03
- [ ] `mcp/tests/tools/delete.test.ts` — covers MCP-04
- [ ] `mcp/vitest.config.ts` — test framework config
- [ ] Framework install: `cd mcp && npm install --save-dev vitest supertest @types/supertest`

---

## Sources

### Primary (HIGH confidence)

- `modelcontextprotocol.io/docs/concepts/transports` — Confirmed Streamable HTTP as current standard; SSE deprecated; security requirements (Origin validation); session management spec
- `modelcontextprotocol.io/docs/concepts/tools` — Tool protocol messages, error handling (isError vs protocol errors), input schema structure
- `modelcontextprotocol.io/docs/concepts/prompts` — Prompt registration, messages structure, listChanged capability
- `modelcontextprotocol.io/quickstart/server` — TypeScript McpServer + registerTool + Zod inputSchema patterns; exact import paths
- `github.com/modelcontextprotocol/typescript-sdk` (v1.x branch) — SDK version confirmed as 1.28.0; StreamableHTTPServerTransport; session management patterns; simpleStreamableHttp.ts example

### Secondary (MEDIUM confidence)

- Phase 1 RESEARCH.md — DB schema, RLS patterns, `set_config('app.agent_id', $1, true)` confirmed for transaction-local scope

### Tertiary (LOW confidence)

- Anthropic embeddings API existence — not verified; flagged as Open Question
- Ollama compose integration — not verified for this specific topology; flagged as Open Question

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — SDK version, package names, and import paths verified from official SDK + npm
- Architecture: HIGH — Patterns derived from official MCP spec and SDK examples
- Pitfalls: HIGH for SET LOCAL, Streamable HTTP Origin validation (both from official spec); MEDIUM for others (derived from patterns, not direct failure reports)
- Embedding providers: MEDIUM for OpenRouter/OpenAI/Ollama (well-documented APIs); LOW for Anthropic (not verified)

**Research date:** 2026-03-27
**Valid until:** 2026-04-27 (30 days — SDK is stable v1.x track)
