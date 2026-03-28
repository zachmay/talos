# Phase 7: Subagent Capability - Research

**Researched:** 2026-03-28
**Domain:** In-process async agent orchestration, provider-agnostic local tool interface, YAML frontmatter profile schema, TypeScript Promise coordination
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Spawning Model**
- In-process subagents — new async `startAgentLoop()` calls within the same container, no new Docker containers
- Conversation manager refactor: entrypoint becomes a conversation manager that owns all active loops (parent + subagents)
- Parent can specify a different agent profile per subagent — profiles loaded at runtime from `/app/agents/`
- All agent profile directories mounted read-only into the container (not just the parent's profile)
- Dynamic profile discovery — conversation manager scans `/app/agents/` at startup, injects available profiles (name + description from AGENT.md frontmatter) into parent's system prompt
- Auto-injected subagent guidance section in parent's system prompt (available profiles, capabilities, usage patterns)

**Local Tool Interface**
- Provider-agnostic tool interface defined in the agent container (not Anthropic-specific, not MCP)
- `spawn_subagent` and `collect_results` registered as local tools through this interface
- Each LLM provider maps local tools to its native format (Anthropic tools, OpenAI function calls, etc.) alongside MCP tools
- Local tool calls intercepted by conversation manager — never hit MCP server
- MCP server stays focused on DB + fetch operations only

**Coordination & Results**
- Fire-and-collect pattern: parent spawns N subagents, then calls `collect_results` which blocks until all complete
- Spawn-batch-then-wait for v1 — but architecture should not preclude true interleaving later
- Subagents start with fresh context only (profile system prompt + task description, no parent conversation history)
- Results returned in-memory to parent — parent decides what to persist via MCP
- Failed subagents return error results individually — other subagents continue, parent decides how to handle failures
- Batch-level timeout on `collect_results` (not per-subagent)
- TUI displays subagents as grouped tool badges: parent badge expands to show nested subagent tool calls
- Subagent token usage rolls up into parent's TUI status bar total (detailed breakdown via /status)

**Identity & Isolation**
- Subagents share parent's API key and RLS identity for v1 (shared DB scope)
- Security concern logged: subagent data isolation is a future hardening opportunity
- No nesting by default — spawn_subagent tool not registered for subagent loops
- Profile-level tool allowlist in AGENT.md frontmatter controls which MCP tools each profile can access
- Default subagent profiles are read-only (search + fetch) — no insert/update/delete
- Profile-level model selection — AGENT.md frontmatter declares preferred LLM model, falls back to parent's model
- Profile-level token budget — AGENT.md frontmatter declares max_tokens, conversation manager enforces
- Subagent skills come from profile directory only (agents/{profile}/skills/), no DB skill access

**Scope & Limits**
- Max concurrent subagents configurable via env var (MAX_SUBAGENTS), no hardcoded cap, sensible default
- Always enabled — controlled by profile tool allowlists, no global kill switch
- `./talos profiles` CLI command: reads all agents/*/AGENT.md, parses frontmatter, displays table (name, model, tools, token budget, description)

**Shipped Profiles**
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

### Deferred Ideas (OUT OF SCOPE)
- Per-subagent identity (separate API keys + RLS scope) — security hardening, own phase
- True interleaving — parent continues working while subagents run in background
- Nested subagent spawning — allow subagents to spawn their own subagents
- Subagent DB skills access — let subagents discover and use DB-stored skills
- Agent-to-agent communication — subagents messaging each other directly
- Per-spawn tool/budget overrides — parent overrides profile defaults per spawn call
- Streaming subagent updates — subagent streams partial results back to parent mid-execution
</user_constraints>

---

## Summary

Phase 7 is primarily a **refactoring + extension phase**. All core primitives already exist: `startAgentLoop()` is a working provider-agnostic dispatcher, `runClaudeLoop()` returns a typed `LoopResult`, skill loading (`buildSkillIndex`) is already profile-aware. The main work is: (1) extracting `entrypoint.ts`'s readline loop into a conversation manager that can own multiple concurrent agent loops, (2) building a local tool interface layer so local tools (`spawn_subagent`, `collect_results`) are intercepted before MCP, (3) extending `prompt.ts` to discover and inject available profiles from `/app/agents/`, (4) adding AGENT.md frontmatter schema for profile capabilities, and (5) updating docker-compose to mount all profile directories and adding the `./talos profiles` CLI subcommand.

The fire-and-collect pattern maps naturally to `Promise.allSettled()` — it handles partial failure (each subagent settles independently), provides typed results, and requires no custom coordination code. A batch-level timeout wraps the `Promise.allSettled()` call using `Promise.race()` against a timeout promise.

The biggest design decision (at Claude's discretion) is how `claude.ts` intercepts local tools. The cleanest approach is a pre-dispatch filter in the agentic loop: before calling MCP, check if the tool name is in the local tool registry; if so, invoke the local handler and return the result directly to the conversation. This keeps MCP clean and makes local tools first-class.

**Primary recommendation:** Refactor entrypoint → conversation manager first, then add local tool interface, then profile discovery, then wire up spawn/collect. Each step is independently testable.

---

## Standard Stack

### Core (already in use)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | ^5.4.0 | Type safety for tool interfaces and profile schemas | Already in use |
| `@anthropic-ai/sdk` | ^0.39.0 | Claude API calls per subagent loop | Already in use |
| `@modelcontextprotocol/sdk` | ^1.0.0 | MCP client per subagent (each loop connects independently) | Already in use |
| `js-yaml` | ^4.1.0 | Frontmatter parsing for AGENT.md profile schema | Already in use |
| `zod` | ^3.22.0 | Runtime validation of AGENT.md frontmatter fields | Already in use |
| `jest` + `ts-jest` | ^29.x | Unit tests for new modules | Already in use |

### No New Libraries Required
All necessary libraries are already installed. Phase 7 is purely an architectural refactor and extension using existing dependencies.

---

## Architecture Patterns

### Profile Frontmatter Schema (AGENT.md)

The existing `AGENT.md` has no frontmatter. Phase 7 adds a YAML frontmatter block at the top. The `buildSkillIndex` pattern in `skills.ts` already demonstrates correct frontmatter parsing (regex match + `js-yaml`).

**Recommended schema:**
```yaml
---
name: research-agent
description: Read-only research assistant for web search and semantic lookup
model: claude-haiku-4-5-20251001
max_tokens: 8192
tools:
  - search_entries
  - fetch
can_spawn: false
---
```

Field semantics:
- `name` — profile identifier, matches directory name
- `description` — injected into parent's system prompt for profile selection
- `model` — overrides `AGENT_LLM_MODEL` env var for this profile; falls back to env var if absent
- `max_tokens` — overrides `AGENT_MAX_TOKENS` for this profile; falls back to env var if absent
- `tools` — MCP tool allowlist; conversation manager filters `listMcpTools()` results to this list
- `can_spawn` — whether `spawn_subagent` is registered for this profile (false by default for subagents)

Validate with Zod at profile load time. Profiles missing required fields (`name`, `description`) should log a warning and be skipped (matches `buildSkillIndex` skip-on-malformed pattern).

### Conversation Manager Architecture

The conversation manager replaces `entrypoint.ts`'s readline loop as the central orchestrator.

```
ConversationManager
├── parentLoop: ActiveLoop         // parent agent state
│   ├── systemPrompt: string
│   ├── history: MessageParam[]
│   └── lastResult: LoopResult | null
├── subagentBatch: Map<id, Promise<SubagentResult>>  // active batch
├── profileRegistry: ProfileDef[]  // discovered at startup
└── localTools: LocalToolRegistry  // spawn_subagent, collect_results
```

**Startup sequence:**
1. Discover profiles: scan `/app/agents/*/AGENT.md`, parse frontmatter, build `ProfileDef[]`
2. Build parent system prompt: `loadSystemPrompt()` + inject subagent guidance section
3. Initialize local tool registry with `spawn_subagent` and `collect_results`
4. Start readline (or HTTP API from Phase 6) event loop

### Local Tool Interface

```typescript
// agent/src/local-tools.ts
export interface LocalToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;  // JSON Schema
}

export interface LocalToolHandler {
  (args: Record<string, unknown>): Promise<string>;
}

export class LocalToolRegistry {
  private tools = new Map<string, { def: LocalToolDef; handler: LocalToolHandler }>();

  register(def: LocalToolDef, handler: LocalToolHandler): void {
    this.tools.set(def.name, { def, handler });
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  async call(name: string, args: Record<string, unknown>): Promise<string> {
    const entry = this.tools.get(name);
    if (!entry) throw new Error(`Local tool '${name}' not found`);
    return entry.handler(args);
  }

  defs(): LocalToolDef[] {
    return [...this.tools.values()].map((e) => e.def);
  }
}
```

**Integration point in `claude.ts`:** The `runClaudeLoop` function receives a `LocalToolRegistry` parameter. In the `tool_use` dispatch block, before calling `callMcpTool`, check `localRegistry.has(block.name)` — if true, call `localRegistry.call()` instead.

```typescript
// Modified tool dispatch in runClaudeLoop
for (const block of toolUseBlocks) {
  try {
    let result: string;
    if (localRegistry && localRegistry.has(block.name)) {
      result = await localRegistry.call(block.name, block.input as Record<string, unknown>);
    } else {
      result = await callMcpTool(mcp, block.name, block.input as Record<string, unknown>);
    }
    toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
  } catch (err) {
    // existing error handling
  }
}
```

**Local tools are merged with MCP tools** when building the Anthropic `tools` array. Convert `LocalToolDef[]` to `Anthropic.Tool[]` using the same shape conversion as MCP tools.

### spawn_subagent Tool

```typescript
// spawn_subagent input schema
{
  type: "object",
  properties: {
    profile: { type: "string", description: "Profile name from available profiles" },
    task: { type: "string", description: "Task description for the subagent" },
    subagent_id: { type: "string", description: "Caller-chosen ID to reference in collect_results" }
  },
  required: ["profile", "task", "subagent_id"]
}
```

Handler behavior:
1. Validate `profile` exists in `ProfileDef[]`
2. Check `activeSubagents.size < MAX_SUBAGENTS` (env var, default 5)
3. Load profile's system prompt (same `loadSystemPrompt()` + `buildSkillIndex()` for profile's skills dir)
4. Apply profile's tool allowlist by filtering MCP tools
5. Build a new `LocalToolRegistry` without `spawn_subagent` (enforces no nesting)
6. Call `startAgentLoop(profilePrompt, task, [])` — fresh history, no parent context
7. Store the resulting `Promise<LoopResult>` in `subagentBatch` keyed by `subagent_id`
8. Return immediately: `"Subagent '{subagent_id}' started with profile '{profile}'."`

### collect_results Tool

```typescript
// collect_results input schema
{
  type: "object",
  properties: {
    timeout_ms: { type: "number", description: "Max ms to wait for all subagents (default 120000)" }
  },
  required: []
}
```

Handler behavior:
```typescript
const timeout = args.timeout_ms ?? 120_000;
const entries = [...subagentBatch.entries()];
if (entries.length === 0) return "No active subagents to collect.";

const timeoutPromise = new Promise<never>((_, reject) =>
  setTimeout(() => reject(new Error("Batch timeout")), timeout)
);

const results = await Promise.race([
  Promise.allSettled(entries.map(([id, p]) => p.then((r) => ({ id, result: r })))),
  timeoutPromise
]);

subagentBatch.clear();
return JSON.stringify(results);  // parent parses structured results
```

`Promise.allSettled()` is the right primitive — it never rejects, each subagent settles independently, and failures are surfaced per-ID without canceling siblings.

### Profile Discovery and Prompt Injection

Extend `prompt.ts` with a new function:

```typescript
// agent/src/prompt.ts additions
export interface ProfileDef {
  name: string;
  description: string;
  model?: string;
  maxTokens?: number;
  tools?: string[];
  canSpawn?: boolean;
}

export function discoverProfiles(agentsDir: string): ProfileDef[] {
  // scan agentsDir/*/AGENT.md, parse frontmatter, validate with Zod
  // skip malformed, return valid ProfileDef[]
}

export function buildSubagentGuidance(profiles: ProfileDef[]): string {
  // returns a markdown section listing available profiles
  // injected into parent's system prompt via new {{SUBAGENT_PROFILES}} placeholder
}
```

The parent `AGENT.md` gains a new placeholder:
```
## Available Subagent Profiles

{{SUBAGENT_PROFILES}}

To spawn subagents: call spawn_subagent with profile name and task description.
Collect all results with collect_results before proceeding.
```

### MCP Tool Filtering Per Profile

When building the tools list for a subagent loop, filter `mcpTools` before conversion:

```typescript
const allowlist = profileDef.tools ?? null;  // null = all tools
const filteredMcpTools = allowlist
  ? mcpTools.filter((t) => allowlist.includes(t.name))
  : mcpTools;
```

Pass `filteredMcpTools` into the Anthropic tools array for subagent loops.

### startAgentLoop Signature Extension

`startAgentLoop` needs new optional parameters for profile-level overrides:

```typescript
export async function startAgentLoop(
  systemPrompt: string,
  userInput: string,
  conversationHistory: Anthropic.MessageParam[],
  options?: {
    model?: string;           // profile model override
    maxTokens?: number;       // profile token budget override
    mcpToolAllowlist?: string[]; // filtered tool names
    localRegistry?: LocalToolRegistry; // local tools (omit for subagents to block spawn)
  }
): Promise<LoopResult>
```

This keeps the function backward-compatible — all existing callers pass no options and get current behavior.

### docker-compose Profile Mounts

Current mount (single profile):
```yaml
- type: bind
  source: ./agents/${AGENT_PROFILE:-base-agent}
  target: /app/agent
  read_only: true
```

New mount strategy (all profiles):
```yaml
- type: bind
  source: ./agents
  target: /app/agents
  read_only: true
# Keep the primary profile mount for backward compat
- type: bind
  source: ./agents/${AGENT_PROFILE:-base-agent}
  target: /app/agent
  read_only: true
```

The `AGENT_DIR` env var (`/app/agent`) continues pointing to the active profile. The new `/app/agents/` mount gives the conversation manager access to all profiles for discovery and subagent spawning.

### talos profiles CLI Command

Follows the Phase 4 pattern exactly: add a `profiles.sh` script and a case entry in `./talos`.

```bash
# scripts/profiles.sh
#!/usr/bin/env bash
set -euo pipefail

AGENTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/agents"

printf "%-20s %-35s %-30s %-12s %s\n" "NAME" "DESCRIPTION" "MODEL" "MAX_TOKENS" "TOOLS"
printf "%s\n" "$(printf '%.0s-' {1..110})"

for agent_md in "$AGENTS_DIR"/*/AGENT.md; do
  # parse frontmatter with python (available in bash env) or node
  ...
done
```

Given the project already uses Node/TypeScript for similar parsing (`skills.ts`, `prompt.ts`), implement `profiles.sh` as a thin wrapper that calls a small Node script to parse frontmatter and format the table.

### TUI Integration (grouped tool badges)

From CONTEXT.md: "TUI displays subagents as grouped tool badges: parent badge expands to show nested subagent tool calls."

Phase 6 TUI already has tool badge components for MCP tool calls. The SSE event stream (Phase 6) needs two new event types:
- `subagent_start` — `{ subagent_id, profile, task }` — triggers creation of a nested badge group
- `subagent_complete` — `{ subagent_id, result_summary, tokens }` — closes the badge group

The conversation manager emits these via the Phase 6 HTTP/SSE layer. Token rollup: accumulate `inputTokens + outputTokens` from all `LoopResult` objects into the parent's running total for the status bar.

### Recommended Project Structure

```
agents/
├── base-agent/
│   ├── AGENT.md           # frontmatter: can_spawn: true, full tools
│   └── skills/
├── research-agent/        # NEW
│   ├── AGENT.md           # frontmatter: model haiku, read-only tools
│   └── skills/            # empty or minimal
└── worker-agent/          # NEW
    ├── AGENT.md           # frontmatter: model sonnet, read-only tools
    └── skills/

agent/src/
├── conversation-manager.ts  # NEW: owns all loops, profile registry
├── local-tools.ts           # NEW: LocalToolRegistry + spawn/collect handlers
├── prompt.ts                # EXTENDED: discoverProfiles(), buildSubagentGuidance()
├── agent.ts                 # EXTENDED: startAgentLoop() gets options param
├── providers/
│   └── claude.ts            # EXTENDED: local tool intercept in tool_use dispatch
├── entrypoint.ts            # REFACTORED: delegates to ConversationManager
└── skills.ts                # UNCHANGED

scripts/
└── profiles.sh              # NEW: reads agents/*/AGENT.md, prints table
```

### Anti-Patterns to Avoid

- **Spawning new Docker containers per subagent:** Slow, complex, breaks shared secrets. In-process is the decision.
- **Passing parent conversation history to subagents:** Creates context bloat, couples subagent results to parent state. Fresh context only.
- **Per-subagent timeout instead of batch timeout:** Creates coordination complexity. Batch timeout via `Promise.race()` is simpler.
- **Nesting via omission:** Do not forget to omit `spawn_subagent` from subagent LocalToolRegistries. Architecture relies on this policy being enforced at registration time.
- **MCP connection reuse across subagents:** Each subagent loop calls `connectMcp()` independently (existing pattern). Do not attempt to share a single MCP client across concurrent loops — the `Client` from `@modelcontextprotocol/sdk` is not designed for concurrent multi-loop sharing.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Partial failure collection | Custom result aggregator | `Promise.allSettled()` | Built-in, typed, handles mixed success/failure |
| Batch timeout | Custom timer + cancellation | `Promise.race([allSettled, timeout])` | Clean composition, no cancellation complexity |
| Frontmatter validation | Custom parser | `js-yaml` + Zod (already in repo) | Already handles edge cases, already a dependency |
| YAML frontmatter parsing | String splitting | Same regex pattern as `skills.ts` | Already proven in the codebase |

---

## Common Pitfalls

### Pitfall 1: MCP Client Concurrency
**What goes wrong:** Reusing a single `Client` instance from `@modelcontextprotocol/sdk` across multiple concurrent subagent loops causes request/response mismatches or errors.
**Why it happens:** The SDK client manages a single transport connection with in-flight request tracking. Concurrent loops would interleave requests.
**How to avoid:** Each `startAgentLoop()` call (including subagent invocations) creates its own `connectMcp()` call with its own `Client` instance. This is already the existing pattern and must remain so.
**Warning signs:** Intermittent MCP errors or tool results appearing in wrong loops.

### Pitfall 2: Forgetting spawn_subagent Omission for Subagent Loops
**What goes wrong:** Subagents can themselves spawn subagents, creating unbounded nesting.
**Why it happens:** If `LocalToolRegistry` is passed through without filtering, subagents inherit all parent tools.
**How to avoid:** When building the `LocalToolRegistry` for a subagent loop, register `collect_results` only — do NOT register `spawn_subagent`. Make this explicit in code with a comment.
**Warning signs:** Subagent completing with "spawned N subagents" in its output.

### Pitfall 3: AGENT.md Frontmatter Absent on base-agent
**What goes wrong:** Profile discovery skips `base-agent` because existing `AGENT.md` has no frontmatter.
**Why it happens:** Current `AGENT.md` has no YAML frontmatter block — it starts directly with `# Talos Base Agent`.
**How to avoid:** Add frontmatter to existing `base-agent/AGENT.md` as part of Phase 7 (Plan Wave 0).
**Warning signs:** `discoverProfiles()` returns only 2 profiles instead of 3.

### Pitfall 4: Tool Allowlist Silently Empty
**What goes wrong:** A profile with a typo in its `tools` frontmatter field gets an empty tool list, making the subagent useless.
**Why it happens:** MCP tool names are case-sensitive; `Search_Entries` vs `search_entries` silently filters to nothing.
**How to avoid:** When filtering MCP tools by allowlist, log a warning if the intersection is empty (and the allowlist is non-empty).
**Warning signs:** Subagent returns immediately without doing any tool calls.

### Pitfall 5: Entrypoint Refactor Breaks Phase 6 HTTP API
**What goes wrong:** Refactoring `entrypoint.ts` into a conversation manager disrupts the Phase 6 Express HTTP server that runs alongside readline.
**Why it happens:** `entrypoint.ts` directly manages readline + HTTP server; careless refactor may split them incorrectly.
**How to avoid:** ConversationManager owns the state (history, lastResult, profiles). Both readline interface and HTTP interface remain as I/O adapters that call `conversationManager.handleInput()`. Neither owns state directly.
**Warning signs:** Phase 6 TUI disconnects after Phase 7 refactor.

### Pitfall 6: Token Budget Not Enforced
**What goes wrong:** A subagent ignores its `max_tokens` profile setting and uses the parent's default.
**Why it happens:** `AGENT_MAX_TOKENS` is read directly from `process.env` in `claude.ts` — profile-level overrides are not passed in.
**How to avoid:** Pass `maxTokens` option through `startAgentLoop()` → `runClaudeLoop()`. The profile's `max_tokens` frontmatter value must reach the `max_tokens` parameter in the Anthropic API call.
**Warning signs:** Subagents burning large token budgets on simple tasks.

---

## Code Examples

### Promise.allSettled for collect_results
```typescript
// Source: MDN / Node.js built-in
const batch: Map<string, Promise<LoopResult>> = new Map();

const results = await Promise.allSettled(
  [...batch.entries()].map(async ([id, p]) => {
    const result = await p;
    return { id, result };
  })
);

// results[i].status === "fulfilled" | "rejected"
// results[i].value or results[i].reason
```

### Batch Timeout with Promise.race
```typescript
// Clean composition — no per-promise cancellation needed
const timeoutMs = 120_000;
const timeoutPromise = new Promise<never>((_, reject) =>
  setTimeout(() => reject(new Error(`Batch timed out after ${timeoutMs}ms`)), timeoutMs)
);

try {
  const settled = await Promise.race([
    Promise.allSettled([...batch.values()]),
    timeoutPromise
  ]);
  batch.clear();
  return JSON.stringify(settled);
} catch (err) {
  batch.clear();
  return `[error]: ${err}`;
}
```

### Zod Schema for Profile Frontmatter
```typescript
import { z } from "zod";

const ProfileSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  model: z.string().optional(),
  max_tokens: z.number().int().positive().optional(),
  tools: z.array(z.string()).optional(),
  can_spawn: z.boolean().optional().default(false),
});

export type ProfileDef = z.infer<typeof ProfileSchema>;

// Usage in discoverProfiles():
const parsed = ProfileSchema.safeParse(raw);
if (!parsed.success) {
  process.stderr.write(`[profiles] Skipping invalid profile at ${agentMdPath}: ${parsed.error.message}\n`);
  continue;
}
```

### Local Tool to Anthropic Tool Conversion
```typescript
// Mirrors existing MCP tool conversion in claude.ts
const localToolsAsAnthropic: Anthropic.Tool[] = localRegistry.defs().map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
}));

const allTools: Anthropic.Tool[] = [...mcpToolsAsAnthropic, ...localToolsAsAnthropic];
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| `entrypoint.ts` owns all state | ConversationManager owns state; entrypoint is I/O adapter | Enables multiple loops, subagent coordination |
| Single global `AGENT_MAX_TOKENS` | Per-profile `max_tokens` in frontmatter | Profile-level cost control |
| Single profile mount | All profiles mounted at `/app/agents/` | Runtime profile switching for subagents |
| No local tools | `LocalToolRegistry` with interceptor in tool dispatch | Provider-agnostic tool extension without MCP |

---

## Open Questions

1. **Phase 6 TUI integration scope**
   - What we know: Phase 6 introduces SSE streaming from agent container; Phase 7 needs to emit `subagent_start` / `subagent_complete` events
   - What's unclear: Phase 6 may not be implemented yet (STATE.md shows phases 1-4 complete; 5-7 planned). Phase 7 should design SSE event emission but may need to stub the TUI rendering side if Phase 6 isn't complete.
   - Recommendation: Plan Phase 7 to emit the correct SSE events from conversation manager; TUI badge rendering is Phase 6's responsibility to consume them.

2. **readline vs HTTP API coexistence after refactor**
   - What we know: Phase 6 adds Express + SSE to entrypoint.ts alongside readline. Phase 7 refactors entrypoint into conversation manager.
   - What's unclear: Exact Phase 6 implementation hasn't been verified (Phase 6 plans exist but execution status unknown)
   - Recommendation: Plan the conversation manager to be I/O-adapter-agnostic. Both readline and HTTP POST become "input sources" that call the same `handleInput()` method.

3. **`profiles.sh` implementation language**
   - What we know: All other scripts are bash but need YAML parsing; Node is available in the repo
   - Recommendation (Claude's discretion): Implement as `node scripts/profiles.js` (compiled from TypeScript) — consistent with existing codebase, reuses the same Zod schema from `prompt.ts`. The shell script becomes a one-liner wrapper.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 29 + ts-jest (ESM preset) |
| Config file | `agent/jest.config.ts` |
| Quick run command | `cd agent && npm test -- --testPathPattern=local-tools` |
| Full suite command | `cd agent && npm test` |

### Phase Requirements → Test Map

Phase 7 introduces no new v1 requirement IDs (requirements are TBD per REQUIREMENTS.md). Testing covers the new modules:

| Module | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| `local-tools.ts` | Registry registers tools, calls by name, returns error for unknown tool | unit | `cd agent && npm test -- --testPathPattern=local-tools` | No — Wave 0 |
| `local-tools.ts` | `spawn_subagent` validates profile exists before starting loop | unit | same | No — Wave 0 |
| `local-tools.ts` | `collect_results` uses Promise.allSettled, clears batch after collect | unit | same | No — Wave 0 |
| `local-tools.ts` | Batch timeout via Promise.race returns error result | unit | same | No — Wave 0 |
| `prompt.ts` | `discoverProfiles()` parses frontmatter from test fixtures | unit | `cd agent && npm test -- --testPathPattern=prompt` | Yes (extend existing) |
| `prompt.ts` | `discoverProfiles()` skips malformed AGENT.md files | unit | same | No — Wave 0 |
| `prompt.ts` | `buildSubagentGuidance()` formats profile list as expected | unit | same | No — Wave 0 |
| `conversation-manager.ts` | Profile registry populated at construction | unit | `cd agent && npm test -- --testPathPattern=conversation-manager` | No — Wave 0 |

### Sampling Rate
- **Per task commit:** `cd agent && npm test -- --testPathPattern="local-tools|prompt|conversation-manager"`
- **Per wave merge:** `cd agent && npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `agent/src/__tests__/local-tools.test.ts` — covers LocalToolRegistry, spawn_subagent, collect_results, timeout
- [ ] `agent/src/__tests__/conversation-manager.test.ts` — covers profile registry, input dispatch
- [ ] Extend `agent/src/__tests__/prompt.test.ts` — covers discoverProfiles(), buildSubagentGuidance()

---

## Sources

### Primary (HIGH confidence)
- Direct code reading of `/Users/zacharymay/Projects/talos/agent/src/` — architecture grounded in actual implementation
- Direct code reading of `agent/package.json` — confirmed dependency versions
- Direct code reading of `docker-compose.yml` — confirmed current mount strategy
- Direct reading of `07-CONTEXT.md` — all locked decisions used as constraints

### Secondary (MEDIUM confidence)
- MDN / Node.js docs for `Promise.allSettled()` behavior (standard since ES2020, Node 12+)
- Anthropic SDK `tools` array format — verified against existing `claude.ts` pattern in codebase

### Tertiary (LOW confidence)
- None — all findings grounded in codebase inspection or standard library behavior

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already in use, no new dependencies required
- Architecture: HIGH — all patterns derived from existing codebase conventions
- Pitfalls: HIGH — derived from code inspection of specific integration points
- Validation: HIGH — existing test infrastructure well understood

**Research date:** 2026-03-28
**Valid until:** 60 days — stable TypeScript/Node stack, no fast-moving external dependencies
