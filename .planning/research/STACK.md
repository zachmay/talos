# Technology Stack

**Project:** Talos
**Researched:** 2026-03-27

> **Version confidence note:** WebSearch, WebFetch, and Bash were unavailable during this research session. All version numbers are from training data (cutoff ~May 2025) and MUST be validated before use. Pin exact versions after running `npm view <pkg> version` for each package.

## Recommended Stack

### Database Layer

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| PostgreSQL | 17 | Primary data store | Latest stable, best pgvector compatibility, RLS mature | MEDIUM |
| pgvector | 0.8.x | Vector similarity search | De facto standard for Postgres vector search, HNSW + IVFFlat indexes, cosine/L2/inner product | MEDIUM |
| Docker image: `pgvector/pgvector:pg17` | latest | Pre-built Postgres + pgvector | Official pgvector team maintains this; no manual extension compilation needed | MEDIUM |

**Why not a separate vector DB (Qdrant, Pinecone, Weaviate):** Talos stores structured data AND vectors together. Keeping everything in Postgres means atomic transactions across semantic and relational data, single backup target, and no inter-service networking for joins. pgvector is sufficient for single-user/team scale.

### MCP Server

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| TypeScript | ~5.7+ | MCP server language | Type safety for schema definitions, best MCP SDK support | MEDIUM |
| `@modelcontextprotocol/sdk` | ~1.12+ | MCP protocol implementation | Official SDK from Anthropic, handles transport/protocol | LOW |
| Node.js | 22 LTS | Runtime | Current LTS, native fetch, stable ESM | MEDIUM |
| `pg` (node-postgres) | ~8.13+ | Postgres client | Battle-tested, streaming support, parameterized queries prevent injection | MEDIUM |
| `zod` | ~3.24+ | Schema validation | MCP SDK uses Zod for tool schemas; single validation library across the stack | MEDIUM |
| `tsx` | ~4.x | TypeScript execution | Zero-config TS execution for dev, faster than ts-node | MEDIUM |

**Why TypeScript over Python for MCP:** The MCP TypeScript SDK is first-party and better maintained than the Python equivalent. The agent container is already an NPM project per PROJECT.md. One language across MCP server + agent skills = simpler Docker builds and shared types.

**Why not Drizzle/Prisma ORM:** The MCP server runs a small number of well-defined queries (insert with embedding, cosine similarity search, update, delete). Raw `pg` with parameterized queries is simpler, more transparent for RLS debugging, and avoids ORM-generated SQL hiding security-relevant behavior.

### Embedding Layer

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Provider interface (custom) | n/a | Abstraction over embedding providers | Simple interface: `embed(text) -> number[]`. Implementations for each provider behind env-var config | HIGH |
| `openai` (npm) | ~4.80+ | OpenAI + OpenRouter embeddings | OpenRouter is OpenAI-API-compatible; one SDK covers both. `text-embedding-3-small` (1536d) as default cloud provider | LOW |
| `@xenova/transformers` or `@huggingface/transformers` | ~3.x | Local embedding fallback | Runs sentence-transformers models locally in Node.js via ONNX. Enables air-gapped/offline mode. `all-MiniLM-L6-v2` (384d) as default local model | LOW |

**Provider switching design:** Environment variable `EMBEDDING_PROVIDER=openrouter|openai|ollama|local` selects the implementation. `EMBEDDING_MODEL` and `EMBEDDING_DIMENSIONS` configure the model. The MCP server reads these at startup. Dimension mismatch between providers requires re-indexing -- this is a known tradeoff documented in PITFALLS.md.

**Why not LangChain/LlamaIndex:** These are orchestration frameworks for complex RAG pipelines. Talos needs a single `embed()` call. Adding LangChain for this is massive dependency bloat (~50+ transitive deps) for a function that's 20 lines of code.

### Agent Harness

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Node.js | 22 LTS | Agent runtime | Same as MCP server; shared base image | MEDIUM |
| Nono | unknown | Sandbox/isolation | Per PROJECT.md requirement. Seccomp + namespace isolation for untrusted code execution | LOW |
| `@anthropic-ai/sdk` | ~0.37+ | Claude API client (if using Claude as agent model) | Official SDK, streaming support | LOW |

**Nono caveat:** I could not verify Nono's current status, npm package name, or documentation. This is flagged as LOW confidence and needs immediate validation. If Nono is unavailable or unmaintained, alternatives in priority order:
1. **gVisor (runsc)** -- Google's container sandbox, Docker-compatible via `--runtime=runsc`
2. **Firecracker microVMs** -- AWS's micro-VM tech, strongest isolation but heavier operational overhead
3. **Docker `--security-opt seccomp=` with custom profile** -- Least effort, weakest isolation, but a reasonable starting point

### Docker / Orchestration

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Docker Compose | v2 (compose.yaml) | Local orchestration | Per PROJECT.md: `docker compose up` and it works | HIGH |
| Multi-stage Dockerfile | n/a | Image builds | Separate build/runtime stages, minimal final images | HIGH |
| Docker networks | n/a | Least-privilege networking | Named networks for db<->mcp and mcp<->agent isolation | HIGH |

**Network topology:**
```
agent-net:  agent <-> mcp
db-net:     mcp <-> postgres
```
Agent cannot reach Postgres directly. This is enforced by Docker network membership, not just application config.

### Dev Tooling

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| `vitest` | ~3.x | Testing | Fast, native ESM/TS, compatible with Node 22 | MEDIUM |
| `eslint` + `@typescript-eslint` | ~9.x / ~8.x | Linting | Flat config era, TS-aware rules | MEDIUM |
| `prettier` | ~3.x | Formatting | Standard, no config debates | MEDIUM |
| `dotenv` | ~16.x | Local env management | Load `.env` files in dev; Docker handles prod injection | MEDIUM |

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Vector DB | pgvector in Postgres | Qdrant, Pinecone, Chroma | Adds a service, splits data, complicates backups. pgvector handles Talos's scale. |
| ORM | Raw `pg` | Drizzle, Prisma | MCP server has ~5 queries. ORM hides RLS behavior. Not worth the abstraction. |
| MCP language | TypeScript | Python | Agent container is NPM-based. One language = one base image = simpler. |
| Embedding orchestration | Custom thin interface | LangChain, LlamaIndex | 20 lines of code vs 50+ transitive dependencies. Talos does one thing: embed text. |
| Container orchestration | Docker Compose | Kubernetes, Nomad | Single-user self-hosted. K8s is massive overkill. Compose is the right tool. |
| Agent framework | Direct SDK calls | AutoGen, CrewAI, LangGraph | Talos runs one agent with a skill library, not multi-agent workflows. Frameworks add indirection without value here. |

## Installation

```bash
# MCP Server dependencies
npm install @modelcontextprotocol/sdk pg zod
npm install -D typescript tsx @types/pg @types/node vitest

# Agent container dependencies
npm install @anthropic-ai/sdk openai zod
npm install -D typescript tsx @types/node

# Local embedding fallback (optional, in agent or MCP container)
npm install @huggingface/transformers

# Validate versions before committing package.json:
# npm view @modelcontextprotocol/sdk version
# npm view pg version
# npm view @anthropic-ai/sdk version
# npm view openai version
```

## Key Version Pins to Validate

These versions are from training data and MUST be checked:

| Package | Stated Version | Validate With |
|---------|---------------|---------------|
| `@modelcontextprotocol/sdk` | ~1.12+ | `npm view @modelcontextprotocol/sdk version` |
| `@anthropic-ai/sdk` | ~0.37+ | `npm view @anthropic-ai/sdk version` |
| `openai` | ~4.80+ | `npm view openai version` |
| `@huggingface/transformers` | ~3.x | `npm view @huggingface/transformers version` |
| pgvector | 0.8.x | Check `pgvector/pgvector:pg17` image |
| Nono | unknown | Verify package exists and is maintained |

## Sources

- pgvector GitHub: https://github.com/pgvector/pgvector (official, HIGH confidence on capabilities)
- MCP specification: https://modelcontextprotocol.io (official, HIGH confidence on protocol)
- MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk (official)
- node-postgres: https://node-postgres.com (official, stable API)
- All version numbers: training data only (LOW confidence, flag for validation)
