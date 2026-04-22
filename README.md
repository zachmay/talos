# Talos

A self-hosted agentic AI platform: semantic memory (PostgreSQL + pgvector) behind a Model Context Protocol (MCP) server, a VS Code editor for browsing/writing notes, and LibreChat as the default conversational interface. Built to run on your own hardware with your own keys.

**Status:** alpha. Single-user focus. See [ROADMAP](.planning/ROADMAP.md) for what's shipped, in flight, and in backlog.

## What's in the box

- **`packages/mcp`** — TypeScript MCP server. Tools for CRUD + semantic search + structured navigation (get, search, update, delete, fetch, list_children, backlinks, recent, search_titles). Pluggable embedding providers (OpenRouter default; OpenAI, Ollama, Anthropic-stub).
- **`packages/vscode-extension`** — VS Code editor integration. Tree view, live-preview markdown editor (Milkdown), wikilink + tag autocomplete, backlinks panel, URI handler for deep links.
- **`scripts/`** — operational shell scripts (`talos` CLI: backup, restore, audit, health, network-audit, security-audit, setup, add-agent).
- **`import-audit/`** — Python tools for importing from Obsidian / Roam and keeping a vault in sync.
- **`db/`** — PostgreSQL schema, RLS policies, and init scripts.
- **`agents/`** — agent container definitions + seccomp profiles.
- **`docker-compose.yml`** (+ `.dev.yml`, `.override.yml`) — orchestration.

Architecture, threat model, and posture details: [SECURITY.md](SECURITY.md). Operator persona: [CLAUDE.md](CLAUDE.md).

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Docker + Docker Compose | latest | Postgres, MCP, MongoDB, LibreChat run in containers |
| Node.js | ≥ 18 | For local extension dev and pnpm |
| pnpm | ≥ 9 | Workspace package manager (`corepack enable pnpm` if you have Node ≥ 16.9) |
| Python | 3.9+ | Only for `import-audit/` scripts |
| macOS / Linux | — | Windows not tested |
| OpenSSL | — | Used by `./talos setup` to generate secrets |

## First-time setup

```bash
# 1. Clone
git clone https://github.com/your-fork/talos.git
cd talos

# 2. Generate secrets (db passwords, agent bearer, LibreChat JWT, etc.)
./talos setup

# 3. Populate the embedding key (OpenRouter by default)
# Edit secrets/embedding_api_key.txt and replace the placeholder

# 4. Install workspace dependencies for local dev
pnpm install

# 5. Start services
docker compose up -d
./talos health        # smoke-test the stack
```

**What `./talos setup` creates:**

- `secrets/db_password.txt`, `secrets/mcp_password.txt` — DB credentials
- `secrets/agent_keys.json` — JSON mapping bearer tokens to agent names, with one `default-agent` key generated for you
- `secrets/embedding_api_key.txt` — placeholder, must be filled in
- `librechat.env` — LibreChat JWT/MongoDB config

Everything in `secrets/` is gitignored. Never commit them.

## Running

### Services

```bash
docker compose up -d              # production-ish stack
docker compose up -d --build mcp  # rebuild MCP after code changes
docker compose logs -f mcp        # tail MCP logs

# Dev overlay: exposes MCP to localhost:3001 and disables bearer auth
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

Services:
- LibreChat: http://localhost:3080
- MCP (dev only): http://localhost:3001
- Postgres: 127.0.0.1:5432 (via `docker-compose.override.yml`, dev convenience)

All host ports are bound to `127.0.0.1` by default. See [SECURITY.md §5](SECURITY.md).

### VS Code extension

Dev mode (F5-equivalent via CLI):

```bash
cd packages/vscode-extension
pnpm build
code --extensionDevelopmentPath="$(pwd)"
```

A new VS Code window opens with Talos loaded. First run prompts for an API key — paste the default-agent bearer from `secrets/agent_keys.json`. The extension remembers it in VS Code's SecretStorage afterward.

Common commands once loaded:

- `Talos: New Note` — create a new entry at a path (prompts for title + path)
- `Talos: Search` — semantic search quickpick
- `Talos: Ping Server` — smoke-test the MCP connection
- Tree view in the activity bar for browsing

### Import from Obsidian / Roam

```bash
python3 import-audit/bulk-import.py           # initial Roam import
python3 import-audit/build-full-manifest.py   # scan an Obsidian vault
python3 import-audit/sync-import.py --dry-run # preview changes
python3 import-audit/sync-import.py           # apply
```

`TALOS_API_KEY` and `TALOS_MCP_URL` env vars override the defaults. Credentials are loaded from `secrets/agent_keys.json` if the env var is unset.

## Configuration

Runtime knobs are env vars in `docker-compose.yml` or overlays:

- `EMBEDDING_PROVIDER` — `openrouter` (default), `openai`, `ollama`, `anthropic` (stub — don't use)
- `VECTOR_DIMENSIONS` — must match the provider's output (1536 for OpenAI ada-002 family)
- `ALLOWED_DOMAINS` — comma-separated allowlist for the fetch tool (`ALLOW_ALL_DOMAINS=true` bypasses; see SECURITY.md)
- `ALLOWED_ORIGINS` — CORS origin allowlist for MCP HTTP transport
- `CHUNK_SIZE`, `CHUNK_OVERLAP` — text chunking parameters before embedding
- `MCP_SKIP_AUTH` — **dev only**, bypasses bearer auth on MCP server
- `LIBRECHAT_PORT`, `DB_PORT` — host port overrides

## Development

```bash
pnpm install                 # workspace install
pnpm typecheck               # recursive typecheck across packages
pnpm ext:build               # rebuild extension
pnpm ext:watch               # watch mode for extension
pnpm mcp:test                # MCP test suite (vitest)
pnpm docker:up / docker:down / docker:logs
```

Operational:

```bash
./talos backup               # DB dump to backups/
./talos restore <file>       # restore from a dump
./talos audit                # query audit log
./talos health               # end-to-end health check
./talos add-agent <name>     # provision a new agent bearer key
./talos security-audit       # verify security guarantees against running stack
```

## Where to look next

- [SECURITY.md](SECURITY.md) — threat model, posture, open questions
- [.planning/ROADMAP.md](.planning/ROADMAP.md) — phases + backlog
- [CLAUDE.md](CLAUDE.md) — Talos operator persona (feeds Claude Code context)
- [.planning/PROJECT.md](.planning/PROJECT.md) — project definition document
