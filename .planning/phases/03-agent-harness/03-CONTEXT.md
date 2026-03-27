# Phase 3: Agent Harness - Context

**Gathered:** 2026-03-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Sandboxed agent container with skill library and NPM project bootstrapping. Agents run in isolation, interact with the database exclusively through MCP, and have a two-layer skill system (repo + DB). Also adds a `fetch` proxy tool to MCP for controlled internet access. Covers AGT-01 through AGT-04.

</domain>

<decisions>
## Implementation Decisions

### Sandbox & Isolation
- Sandbox-agnostic design via profile-based levels:
  - `standard` (default, all platforms inc. macOS): Docker seccomp, no-new-privileges, dropped capabilities, read-only rootfs
  - `strict` (Linux + gVisor): all of standard plus `runtime: runsc` for syscall interception
- MVP targets macOS local dev using `standard` profile — plug-and-play with other deployments via profile switch
- No host filesystem access — only explicitly defined volumes
- Agent on `frontend` network only (from Phase 1) — can reach MCP, nothing else directly
- Internet access proxied through MCP via a `fetch` tool (added to MCP in this phase)
  - MCP can log, rate-limit, and allowlist domains
  - Configurable: `ALLOWED_DOMAINS` env var or `ALLOW_ALL_DOMAINS=true`
- tmpfs workspace at `/app/workspace` (in-memory, ephemeral) + `/tmp`
- Read-only root filesystem
- Configurable resource limits: CPU and memory via compose deploy config

### Skill Library Design
- Two-layer skill system:
  - **Repo skills:** Version-controlled in `agents/{profile}/skills/`. Each skill is a directory with `SKILL.md` (YAML frontmatter: name, description; markdown body: full details). Can include `REFERENCES.md` (do's/don'ts) and executable scripts (Node.js)
  - **DB skills:** Stored as entries in the database with `metadata: {type: "skill"}` and path convention `['skills', 'category', 'skill-name']`. Managed via normal MCP CRUD. Agents discover via search or path listing
- Repo skills mounted read-only in container at `/app/agent/skills/`
- Minimal skill index in system prompt (names only) — agent reads full `SKILL.md` content on demand
- Executable skills invoked via shell: `node /app/agent/skills/{name}/run.js {args}`
- Script dependencies installed via npm at image build time (pre-built, no install at runtime)

### Agent Prompt & Bootstrap
- Agent configurations as named directories: `agents/base-agent/`, `agents/research-agent/`, etc.
  - Each contains `AGENT.md` (system prompt) and `skills/` directory
  - `AGENT_PROFILE` env var selects which directory to mount (default: `base-agent`)
  - Compose mounts `./agents/${AGENT_PROFILE}/` to `/app/agent/` read-only
- Pre-built images — npm install at build time, no install at container start
- Base image + provider layers for LLM integration:
  - `Dockerfile.base` — shared setup (Node, security, sandbox config)
  - `Dockerfile.claude` — extends base with Anthropic SDK
  - `Dockerfile.openrouter` — extends base with OpenRouter client
  - `Dockerfile.ollama` — extends base with Ollama client
  - Compose selects: `dockerfile: agent/Dockerfile.${AGENT_PROVIDER:-claude}`
- LLM provider configured via env vars: `AGENT_LLM_PROVIDER`, `AGENT_LLM_MODEL`, `AGENT_LLM_API_KEY`

### Container Lifecycle
- Long-running container — stays up, waits for input
- Operator interacts via stdin/stdout through `docker compose attach agent`
- Logs to stderr (viewable via `docker compose logs agent`)
- Auto-restart on failure with backoff: `restart: on-failure:5`
- Ephemeral conversation history — each restart is a clean slate. Agent's persistent memory is the database via MCP. Forces "if it matters, store it" philosophy.

### Claude's Discretion
- Exact seccomp profile and capability set for `standard` sandbox
- Entrypoint script implementation
- Skill index generation logic
- MCP fetch tool parameter design (beyond domain allowlisting)
- Agent prompt content and structure within AGENT.md

</decisions>

<specifics>
## Specific Ideas

- Agent profiles as mountable directories — swap personality/skills by changing one env var
- "If it matters, store it" — ephemeral workspace forces agents to persist important data to DB
- DB skills use the same entries table + path system from Phase 1 — no special tables needed
- SKILL.md with YAML frontmatter mirrors common documentation patterns (Jekyll, Hugo)
- Fetch proxy through MCP keeps the agent network-isolated while enabling web access — defense in depth

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — greenfield project, no existing code

### Established Patterns
- Phase 1: Docker secrets, dual-network topology, compose profiles (dev/prod), stub services
- Phase 2: MCP Streamable HTTP transport, agent API key auth, progressive discovery prompts, TypeScript

### Integration Points
- Agent connects to MCP on `frontend` network via Streamable HTTP
- Agent authenticates with per-agent API key (from `agent_keys.json` secret, Phase 2)
- Skills mount read-only from host `agents/{profile}/skills/` directory
- DB skills stored as entries, discovered via MCP search/path listing
- `fetch` tool added to MCP server (Phase 2 codebase) during this phase
- `setup.sh` (Phase 1) extended to create agent LLM API key secrets

</code_context>

<deferred>
## Deferred Ideas

- Task-based / one-shot agent mode — future enhancement
- HTTP API for agent interaction — future, enables programmatic access
- Conversation history persistence — could be opt-in later via named volume
- Agent-to-agent communication — future phase
- Write approval flow (AGT-V2-01) — v2 requirement

</deferred>

---

*Phase: 03-agent-harness*
*Context gathered: 2026-03-27*
