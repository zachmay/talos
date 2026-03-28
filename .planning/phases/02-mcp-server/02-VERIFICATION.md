---
phase: 02-mcp-server
verified: 2026-03-28T03:25:00Z
status: human_needed
score: 8/8 truths verified
re_verification:
  previous_status: gaps_found
  previous_score: 6/8
  gaps_closed:
    - "Update and delete tools receive agentId at runtime — not from tool input"
    - "TypeScript compiles without errors (npx tsc --noEmit exits 0)"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "docker compose up and live MCP insert/search roundtrip"
    expected: "docker compose up starts db and mcp; POST /mcp with insert tool call returns {id, content, path}; follow-up search returns the inserted entry"
    why_human: "Requires live Postgres, Docker, and real embedding provider or mock env"
  - test: "Origin validation rejects unexpected Origin headers"
    expected: "POST /mcp with Origin: http://evil.com returns 403 ORIGIN_REJECTED; POST /mcp with no Origin header proceeds to auth check"
    why_human: "Requires running server instance"
---

# Phase 02: MCP Server Verification Report

**Phase Goal:** Build a working MCP server with CRUD tools, embedding providers, auth middleware, and Docker integration.
**Verified:** 2026-03-28T03:25:00Z
**Status:** human_needed
**Re-verification:** Yes — after gap closure (previous score 6/8, now 8/8)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | All 58 tests pass (vitest run) | VERIFIED | 9 test files, 58 tests, 0 failures — confirmed on re-verification |
| 2 | EMBEDDING_PROVIDER env var selects correct adapter | VERIFIED | factory.test.ts GREEN; interface.ts switch statement confirmed |
| 3 | Insert and search tools embed content transparently | VERIFIED | insert.ts calls createEmbeddingProvider(); search.ts calls createEmbeddingProvider(); agentId from closure |
| 4 | Auth middleware enforces 401/403 on /mcp routes | VERIFIED | transport.ts applies authMiddleware on all POST/GET/DELETE /mcp routes; auth.ts fully implemented |
| 5 | Update and delete tools receive agentId at runtime | VERIFIED | registerUpdateTool(server, agentId) and registerDeleteTool(server, agentId) now use closure — fixed in gap closure |
| 6 | docker compose config validates with mcp service | VERIFIED | mcp service on backend+frontend networks, agent_keys+embedding_api_key+mcp_password secrets, healthcheck defined |
| 7 | TypeScript compiles without errors | VERIFIED | rootDir removed from tsconfig.json; npx tsc --noEmit exits 0 with no output |
| 8 | Three MCP prompts registered | VERIFIED | server.ts calls registerPathOperationsPrompt, registerAdvancedSearchPrompt, registerBulkOperationsPrompt |

**Score:** 8/8 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `mcp/src/auth.ts` | authMiddleware + loadAgentKeys | VERIFIED | Exports both; loads from /run/secrets/agent_keys with AGENT_KEYS_PATH fallback |
| `mcp/src/db.ts` | pool + withAgent() with SET LOCAL | VERIFIED | Uses set_config(..., true) for transaction-local scope |
| `mcp/src/chunker.ts` | chunkText() with overlap validation | VERIFIED | Validates overlap >= chunkSize; sliding window correct |
| `mcp/src/providers/interface.ts` | EmbeddingProvider + createEmbeddingProvider | VERIFIED | Switch on EMBEDDING_PROVIDER; defaults to openrouter |
| `mcp/src/providers/openrouter.ts` | OpenRouterProvider | VERIFIED | embed() + dimensions implemented |
| `mcp/src/providers/openai.ts` | OpenAIProvider | VERIFIED | embed() + dimensions implemented |
| `mcp/src/providers/ollama.ts` | OllamaProvider | VERIFIED | embed() + dimensions; uses prompt not input |
| `mcp/src/providers/anthropic.ts` | Stub with NOT_VERIFIED comment | VERIFIED | Comment block present; embed() throws EMBEDDING_FAILED |
| `mcp/src/tools/insert.ts` | registerInsertTool — MCP-01 | VERIFIED | Embeds before write; atomic transaction; agentId from closure |
| `mcp/src/tools/search.ts` | registerSearchTool — MCP-02 | VERIFIED | match_entries call; path-only mode; agentId from closure |
| `mcp/src/tools/update.ts` | registerUpdateTool — MCP-03 | VERIFIED | registerUpdateTool(server, agentId) — closure pattern now matches insert/search |
| `mcp/src/tools/delete.ts` | registerDeleteTool — MCP-04 | VERIFIED | registerDeleteTool(server, agentId) — closure pattern now matches insert/search |
| `mcp/src/server.ts` | createServer() registering all tools with agentId | VERIFIED | Lines 13-16 pass agentId to all four registerXxxTool calls |
| `mcp/src/transport.ts` | Express + StreamableHTTP transport + auth | VERIFIED | authMiddleware applied; originGuard applied; /health endpoint; session map |
| `mcp/src/prompts/path-operations.ts` | Path operations prompt | VERIFIED | Exists; registerPathOperationsPrompt exported |
| `mcp/src/prompts/advanced-search.ts` | Advanced search prompt | VERIFIED | Exists; registerAdvancedSearchPrompt exported |
| `mcp/src/prompts/bulk-operations.ts` | Bulk operations prompt | VERIFIED | Exists; registerBulkOperationsPrompt exported |
| `mcp/Dockerfile` | Multi-stage build for mcp service | VERIFIED | node:20-alpine; uses tsx; healthcheck defined |
| `docker-compose.yml` | mcp service integrated | VERIFIED | backend+frontend networks; all 3 secrets; depends_on db |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| mcp/src/transport.ts | authMiddleware | app.post/get/delete /mcp | WIRED | originGuard then authMiddleware on all /mcp routes |
| mcp/src/transport.ts | StreamableHTTPServerTransport | POST/GET/DELETE /mcp | WIRED | Confirmed in source |
| mcp/src/server.ts | insert/search/update/delete tools | registerXxxTool(server, agentId) | WIRED | All four calls now pass agentId — gap closed |
| mcp/src/tools/insert.ts | createEmbeddingProvider | Before DB write | WIRED | Embedding before withAgent call |
| mcp/src/tools/insert.ts | withAgent() | Atomic entry+chunks transaction | WIRED | Single withAgent wraps both INSERT statements |
| mcp/src/tools/search.ts | match_entries DB function | withAgent SQL call | WIRED | SELECT * FROM match_entries($1,$2,$3,$4,$5) |
| mcp/src/tools/update.ts | withAgent() | Delete+update+insert transaction | WIRED | agentId from closure; logic correct |
| mcp/src/tools/delete.ts | entries table (chunks CASCADE) | DELETE FROM entries | WIRED | No manual chunk delete; relies on FK CASCADE |
| mcp/src/auth.ts | /run/secrets/agent_keys | fs.readFileSync at module load | WIRED | resolveKeysPath() with AGENT_KEYS_PATH fallback |
| mcp/src/providers/interface.ts | EMBEDDING_PROVIDER env var | createEmbeddingProvider switch | WIRED | Confirmed |
| docker-compose.yml | mcp service | backend network, secrets, DATABASE_URL | WIRED | All three secrets mounted; DATABASE_URL set |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| MCP-01 | 02-01, 02-04, 02-06 | Insert with automatic embedding | SATISFIED | insert.ts embeds+chunks+writes atomically; 58 tests GREEN |
| MCP-02 | 02-01, 02-04, 02-06 | Similarity search with filters | SATISFIED | search.ts calls match_entries; path-only mode; verbose mode; tests GREEN |
| MCP-03 | 02-01, 02-05, 02-06 | Update content + re-embed | SATISFIED | registerUpdateTool(server, agentId) — closure pattern correct; tests GREEN |
| MCP-04 | 02-01, 02-05, 02-06 | Delete with cascade | SATISFIED | registerDeleteTool(server, agentId) — closure pattern correct; tests GREEN |
| MCP-05 | 02-01, 02-03, 02-06 | Provider-agnostic via env var | SATISFIED | createEmbeddingProvider() factory; 4 providers; factory tests GREEN |
| MCP-06 | 02-01, 02-03, 02-04, 02-06 | Embedding owned by MCP server | SATISFIED | All tool handlers call createEmbeddingProvider(); agents pass no vectors |
| MCP-07 | 02-01, 02-02, 02-06 | Multi-agent auth + RLS | SATISFIED | authMiddleware enforces 401/403; withAgent sets app.agent_id per transaction |

### Anti-Patterns Found

No blockers or warnings remaining. Previously identified anti-patterns resolved:

- `(extra as any).agentId` pattern removed from update.ts and delete.ts
- `rootDir` removed from mcp/tsconfig.json; tsc --noEmit exits clean

### Human Verification Required

#### 1. Live docker compose roundtrip

**Test:** Run `docker compose up` (with valid secrets), send POST /mcp with Authorization header and insert tool call, then POST /mcp with search tool call for the same content.
**Expected:** Insert returns `{id, content, path}`; search returns the entry with cosine similarity > threshold.
**Why human:** Requires live Postgres with pgvector, real embedding provider API key or Ollama, and Docker runtime.

#### 2. Origin validation enforcement

**Test:** POST /mcp with `Origin: http://evil.example.com` header and valid API key.
**Expected:** 403 ORIGIN_REJECTED returned before auth is checked.
**Why human:** Requires running Express server instance.

### Gaps Summary

No gaps remaining. Both previously identified gaps were closed:

**Gap 1 — agentId for update/delete (CLOSED):** `registerUpdateTool` and `registerDeleteTool` now accept `agentId: string` as a second parameter and use closure inside the `server.tool()` callback, matching the pattern used by insert and search. `server.ts` passes `agentId` to all four registrations on lines 13-16.

**Gap 2 — tsconfig rootDir conflict (CLOSED):** `rootDir` was removed from `mcp/tsconfig.json`. TypeScript now infers the root from the `include` patterns, allowing both `src/**/*` and `tests/**/*` without TS6059 errors. `npx tsc --noEmit` exits 0.

---

_Verified: 2026-03-28T03:25:00Z_
_Verifier: Claude (gsd-verifier)_
