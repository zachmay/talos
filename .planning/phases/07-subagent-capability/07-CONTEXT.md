# Phase 7: Subagent Capability - Context

**Gathered:** 2026-03-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Enable agents to spawn and coordinate subagents for parallel and delegated task execution. Delivers a conversation manager in the agent container, a provider-agnostic local tool interface, spawn/collect coordination primitives, profile-based capability control, and a `./talos profiles` CLI command. Covers subagent spawning, coordination, identity, and resource limits.

</domain>

<decisions>
## Implementation Decisions

### Spawning Model
- In-process subagents — new async `startAgentLoop()` calls within the same container, no new Docker containers
- Conversation manager refactor: entrypoint becomes a conversation manager that owns all active loops (parent + subagents)
- Parent can specify a different agent profile per subagent — profiles loaded at runtime from `/app/agents/`
- All agent profile directories mounted read-only into the container (not just the parent's profile)
- Dynamic profile discovery — conversation manager scans `/app/agents/` at startup, injects available profiles (name + description from AGENT.md frontmatter) into parent's system prompt
- Auto-injected subagent guidance section in parent's system prompt (available profiles, capabilities, usage patterns)

### Local Tool Interface
- Provider-agnostic tool interface defined in the agent container (not Anthropic-specific, not MCP)
- `spawn_subagent` and `collect_results` registered as local tools through this interface
- Each LLM provider maps local tools to its native format (Anthropic tools, OpenAI function calls, etc.) alongside MCP tools
- Local tool calls intercepted by conversation manager — never hit MCP server
- MCP server stays focused on DB + fetch operations only

### Coordination & Results
- Fire-and-collect pattern: parent spawns N subagents, then calls `collect_results` which blocks until all complete
- Spawn-batch-then-wait for v1 — but architecture should not preclude true interleaving later
- Subagents start with fresh context only (profile system prompt + task description, no parent conversation history)
- Results returned in-memory to parent — parent decides what to persist via MCP (fits "if it matters, store it" philosophy)
- Failed subagents return error results individually — other subagents continue, parent decides how to handle failures
- Batch-level timeout on `collect_results` (not per-subagent)
- TUI displays subagents as grouped tool badges: parent badge expands to show nested subagent tool calls
- Subagent token usage rolls up into parent's TUI status bar total (detailed breakdown via /status)

### Identity & Isolation
- Subagents share parent's API key and RLS identity for v1 (shared DB scope)
- **Security concern logged:** subagent data isolation (separate API keys / RLS scoping per subagent) is a future hardening opportunity
- No nesting by default — spawn_subagent tool not registered for subagent loops (policy restriction, not structural; architecture supports enabling nesting later)
- Profile-level tool allowlist in AGENT.md frontmatter controls which MCP tools each profile can access
- Default subagent profiles are read-only (search + fetch) — no insert/update/delete
- Profile-level model selection — AGENT.md frontmatter declares preferred LLM model, falls back to parent's model if not specified
- Profile-level token budget — AGENT.md frontmatter declares max_tokens, conversation manager enforces
- Subagent skills come from profile directory only (agents/{profile}/skills/), no DB skill access

### Scope & Limits
- Max concurrent subagents configurable via env var (MAX_SUBAGENTS), no hardcoded cap, sensible default
- Always enabled — controlled by profile tool allowlists, no global kill switch
- `./talos profiles` CLI command: reads all agents/*/AGENT.md, parses frontmatter, displays table (name, model, tools, token budget, description)

### Shipped Profiles
- 3 profiles ship out of the box:
  - `base-agent` — full access, can spawn subagents (parent)
  - `research-agent` — haiku, read-only (search + fetch), lower token budget
  - `worker-agent` — sonnet, read-only (search + fetch), moderate token budget

### Claude's Discretion
- Conversation manager internal architecture and state management
- Local tool interface implementation details
- AGENT.md frontmatter schema design (exact field names, validation)
- How profile discovery integrates with existing prompt.ts
- collect_results implementation (Promise.allSettled vs custom)
- Default values for MAX_SUBAGENTS and batch timeout
- TUI grouped badge rendering details

</decisions>

<specifics>
## Specific Ideas

- Conversation manager as the evolution of the current entrypoint — not a separate service, a refactor of the existing loop orchestration
- Profile frontmatter as the single source of truth for agent capabilities (model, tools, budget, description)
- Architecture explicitly designed to not preclude: true interleaving, nested subagent spawning, per-subagent identity — all are future upgrades that the v1 design should accommodate

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `agent/src/agent.ts`: `startAgentLoop()` — provider-agnostic dispatcher, becomes the core of subagent spawning
- `agent/src/providers/claude.ts`: `runClaudeLoop()` with `LoopResult` interface — each subagent returns a LoopResult
- `agent/src/prompt.ts`: System prompt loader + skill index builder — extend for multi-profile loading and subagent guidance injection
- `agent/src/entrypoint.ts`: Current readline loop — refactors into conversation manager
- `agent/src/skills.ts`: Skill loading — reuse for per-profile skill directories
- `./talos` CLI wrapper: Add `profiles` subcommand (Phase 4 pattern)
- Phase 4 audit triggers: May need awareness of subagent metadata header for future audit differentiation

### Established Patterns
- Phase 3: Agent profiles as mountable directories with AGENT_PROFILE env var
- Phase 3: Provider layers (Dockerfile.claude, .openrouter, .ollama) — local tool interface must work across all
- Phase 2: MCP tool registration pattern — local tools follow similar shape
- Phase 4: CLI subcommand pattern in `./talos` wrapper

### Integration Points
- `agent/src/entrypoint.ts` — refactor into conversation manager
- `agent/src/agent.ts` — extend with local tool interface
- `agent/src/prompt.ts` — multi-profile loading, subagent guidance injection
- `docker-compose.yml` — mount all `agents/*/` directories (not just AGENT_PROFILE)
- `./talos` — add `profiles` subcommand
- `agents/` directory — add research-agent/ and worker-agent/ profiles
- TUI (Phase 6) — grouped tool badge rendering for subagent activity

</code_context>

<deferred>
## Deferred Ideas

- **Per-subagent identity (separate API keys + RLS scope)** — security hardening, own phase
- **True interleaving** — parent continues working while subagents run in background
- **Nested subagent spawning** — allow subagents to spawn their own subagents (policy toggle)
- **Subagent DB skills access** — let subagents discover and use DB-stored skills
- **Agent-to-agent communication** — subagents messaging each other directly (noted in Phase 3 deferred)
- **Per-spawn tool/budget overrides** — parent overrides profile defaults per spawn call
- **Streaming subagent updates** — subagent streams partial results back to parent mid-execution

</deferred>

---

*Phase: 07-subagent-capability*
*Context gathered: 2026-03-28*
