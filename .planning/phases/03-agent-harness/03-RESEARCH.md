# Phase 3: Agent Harness - Research

**Researched:** 2026-03-27
**Domain:** Docker sandbox isolation, Node.js agentic loop, MCP client integration, skill library patterns
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Sandbox & Isolation**
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

**Skill Library Design**
- Two-layer skill system:
  - Repo skills: Version-controlled in `agents/{profile}/skills/`. Each skill is a directory with `SKILL.md` (YAML frontmatter: name, description; markdown body: full details). Can include `REFERENCES.md` (do's/don'ts) and executable scripts (Node.js)
  - DB skills: Stored as entries in the database with `metadata: {type: "skill"}` and path convention `['skills', 'category', 'skill-name']`. Managed via normal MCP CRUD. Agents discover via search or path listing
- Repo skills mounted read-only in container at `/app/agent/skills/`
- Minimal skill index in system prompt (names only) — agent reads full `SKILL.md` content on demand
- Executable skills invoked via shell: `node /app/agent/skills/{name}/run.js {args}`
- Script dependencies installed via npm at image build time (pre-built, no install at runtime)

**Agent Prompt & Bootstrap**
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

**Container Lifecycle**
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

### Deferred Ideas (OUT OF SCOPE)
- Task-based / one-shot agent mode — future enhancement
- HTTP API for agent interaction — future, enables programmatic access
- Conversation history persistence — could be opt-in later via named volume
- Agent-to-agent communication — future phase
- Write approval flow (AGT-V2-01) — v2 requirement
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AGT-01 | Sandboxed container with strong isolation (Nono/gVisor) | Docker seccomp, cap_drop, no-new-privileges, read-only rootfs for `standard`; `runtime: runsc` for `strict` (Linux only). Nono is not a known package — confirmed non-existent. gVisor confirmed Linux-only; macOS MVP uses `standard` profile |
| AGT-02 | Main agent prompt definition | AGENT.md loaded at startup, skill index injected, MCP connection via Anthropic beta MCP connector using `mcp-client-2025-11-20` beta header |
| AGT-03 | Skill library — declarative references plus executable scripts | Two-layer (repo + DB). Repo skills as directories with SKILL.md + run.js. Invoked via Node.js child_process.execFile(). DB skills discovered via MCP path listing |
| AGT-04 | NPM project — `npm install` bootstraps all agent dependencies | Standard package.json in each agent profile directory. Dependencies installed at build time via `RUN npm install` in Dockerfile. Runtime: no install needed |
</phase_requirements>

---

## Summary

Phase 3 creates the sandboxed agent container that sits on the `frontend` network, communicates exclusively with the MCP server, and runs a two-layer skill system. The architecture is security-first: standard profile achieves strong isolation on all platforms (including macOS) using Docker-native primitives, while strict profile adds gVisor on Linux.

The agent is a long-running Node.js process. It reads its system prompt from `AGENT.md`, injects a skill index, then enters an agentic loop: call the Anthropic API with MCP tool access (via the `mcp-client-2025-11-20` beta), process tool calls, repeat until `stop_reason: "end_turn"`. Skill scripts are invoked as child processes using `child_process.execFile()` with explicit timeout and output capture.

The `fetch` tool is added to the Phase 2 MCP server in this phase, giving agents proxied internet access with domain allowlisting. The MCP server remains the only external interface the agent touches.

**Primary recommendation:** Build `standard` profile first, verify sandbox isolation on macOS, then add `strict` profile as a documented opt-in for Linux deployments. Use the Anthropic MCP connector beta (`mcp-client-2025-11-20`) rather than a custom MCP client library — it handles tool execution server-side and simplifies the agentic loop.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@anthropic-ai/sdk` | ^0.39+ | Anthropic API client with MCP connector | Official SDK; beta MCP connector eliminates custom MCP client code |
| `@modelcontextprotocol/sdk` | ^1.x | MCP client helpers (mcpTools, mcpMessages) | Needed if using local stdio transport or MCP helpers; optional if using URL-based MCP connector |
| `node` | 22 LTS | Agent runtime | LTS, matches Phase 2 MCP server |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod` | ^3.x | Schema validation for skill inputs/config | Standard for runtime validation in the ecosystem |
| `js-yaml` | ^4.x | Parse YAML frontmatter in SKILL.md files | Pure JS, no native deps — safe inside container |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Anthropic MCP connector beta | Custom MCP client (StreamableHTTP) | Beta connector is simpler but requires beta header; custom client gives more control but more code |
| `child_process.execFile()` | `child_process.exec()` | `execFile` avoids shell injection risk; `exec` is slightly simpler but unsafe with dynamic args |
| tmpfs for workspace | Named volume | tmpfs is ephemeral by design (enforces "if it matters, store it"); named volume persists across restarts |

**Installation (agent Dockerfile):**
```bash
npm install @anthropic-ai/sdk @modelcontextprotocol/sdk zod js-yaml
```

---

## Architecture Patterns

### Recommended Project Structure

```
agent/
├── Dockerfile.base          # Node 22, security hardening, non-root user
├── Dockerfile.claude        # extends base, adds @anthropic-ai/sdk
├── Dockerfile.openrouter    # extends base, adds openrouter client
├── Dockerfile.ollama        # extends base, adds ollama client
├── entrypoint.sh            # reads AGENT.md, builds skill index, starts agent
├── package.json             # shared deps
├── src/
│   ├── agent.ts             # main agentic loop
│   ├── skills.ts            # skill index loading, execFile wrapper
│   └── providers/
│       ├── claude.ts        # Anthropic API + MCP connector
│       ├── openrouter.ts    # OpenRouter client
│       └── ollama.ts        # Ollama client
agents/
├── base-agent/
│   ├── AGENT.md             # system prompt template
│   └── skills/
│       └── example-skill/
│           ├── SKILL.md     # frontmatter: name, description; body: details
│           ├── REFERENCES.md  # do's/don'ts (optional)
│           └── run.js       # executable skill script
└── research-agent/
    ├── AGENT.md
    └── skills/
```

### Pattern 1: Standard Sandbox Profile (docker-compose)

**What:** Docker-native isolation using seccomp, capability dropping, no-new-privileges, and read-only rootfs with tmpfs overlays.

**When to use:** Default (macOS, Linux without gVisor). All platforms.

```yaml
# Source: Docker Compose services spec + Docker security docs
services:
  agent:
    build:
      context: .
      dockerfile: agent/Dockerfile.${AGENT_PROVIDER:-claude}
    read_only: true
    tmpfs:
      - /app/workspace:mode=755,uid=1000,gid=1000
      - /tmp:mode=1777
    security_opt:
      - no-new-privileges:true
      - seccomp:./agent/seccomp-standard.json
    cap_drop:
      - ALL
    networks:
      - frontend
    environment:
      - AGENT_PROFILE=${AGENT_PROFILE:-base-agent}
      - AGENT_LLM_PROVIDER=${AGENT_LLM_PROVIDER:-claude}
      - AGENT_LLM_MODEL=${AGENT_LLM_MODEL}
      - AGENT_LLM_API_KEY_FILE=/run/secrets/agent_llm_key
    secrets:
      - agent_llm_key
      - agent_api_key
    deploy:
      resources:
        limits:
          cpus: '${AGENT_CPU_LIMIT:-1.0}'
          memory: '${AGENT_MEMORY_LIMIT:-512M}'
    restart: on-failure:5
    volumes:
      - type: bind
        source: ./agents/${AGENT_PROFILE:-base-agent}
        target: /app/agent
        read_only: true
    stdin_open: true
    tty: true
```

### Pattern 2: Strict Sandbox Profile (Linux + gVisor)

**What:** Extends standard profile with `runtime: runsc` (gVisor). Intercepts all syscalls in userspace.

**When to use:** Linux hosts only. Not available on macOS (gVisor requires Linux kernel). Enabled via compose profile `strict`.

```yaml
# Source: gVisor docs + Docker Compose runtime field
services:
  agent:
    extends:
      service: agent  # inherits standard config
    runtime: runsc    # requires gVisor installed on host: https://gvisor.dev/docs/user_guide/install/
    profiles:
      - strict
```

### Pattern 3: Agentic Loop with MCP Connector

**What:** Main agent loop using Anthropic SDK MCP connector beta. The connector handles MCP tool calls server-side — no need for a custom MCP client transport.

**When to use:** When agent provider is Claude (Anthropic API).

```typescript
// Source: https://platform.claude.com/docs/en/agents-and-tools/mcp-connector
// Beta: mcp-client-2025-11-20
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.AGENT_LLM_API_KEY });

async function runAgentLoop(systemPrompt: string, userInput: string) {
  const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [
    { role: "user", content: userInput }
  ];

  while (true) {
    const response = await anthropic.beta.messages.create({
      model: process.env.AGENT_LLM_MODEL ?? "claude-sonnet-4-6",
      max_tokens: 8192,
      system: systemPrompt,
      messages,
      mcp_servers: [
        {
          type: "url",
          url: process.env.MCP_SERVER_URL!,  // e.g. http://mcp:3000/mcp
          name: "talos-mcp",
          authorization_token: process.env.AGENT_API_KEY
        }
      ],
      tools: [{ type: "mcp_toolset", mcp_server_name: "talos-mcp" }],
      betas: ["mcp-client-2025-11-20"]
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn") {
      // Extract final text response
      const text = response.content
        .filter(b => b.type === "text")
        .map(b => (b as Anthropic.Beta.Messages.BetaTextBlock).text)
        .join("");
      return text;
    }
    // MCP tool results are handled server-side — loop continues automatically
    // Stop if we hit max turns to prevent infinite loops
  }
}
```

**IMPORTANT NOTE:** The MCP connector requires the MCP server URL to be accessible via HTTPS in production. For local Docker networking (`http://mcp:3000`), this may require either a local TLS termination or using the client-side MCP helpers instead. Verify this constraint during implementation — the beta docs state "Must start with https://" for the `url` field.

### Pattern 4: Skill Index Loading

**What:** At startup, scan `/app/agent/skills/` directory, parse YAML frontmatter from each `SKILL.md`, build a compact index string to inject into the system prompt.

```typescript
// Source: SKILL.md design from CONTEXT.md + js-yaml docs
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

interface SkillMeta { name: string; description: string; }

function buildSkillIndex(skillsDir: string): string {
  const skills: SkillMeta[] = [];

  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillMdPath = path.join(skillsDir, entry.name, "SKILL.md");
    if (!fs.existsSync(skillMdPath)) continue;

    const content = fs.readFileSync(skillMdPath, "utf8");
    // Extract YAML frontmatter between --- delimiters
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) continue;

    const meta = yaml.load(match[1]) as SkillMeta;
    if (meta.name && meta.description) skills.push(meta);
  }

  return skills.map(s => `- ${s.name}: ${s.description}`).join("\n");
}
```

### Pattern 5: Skill Execution

**What:** Execute a skill script as a child process with timeout and output capture.

```typescript
// Source: Node.js child_process docs
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function executeSkill(skillName: string, args: string[]): Promise<string> {
  const scriptPath = `/app/agent/skills/${skillName}/run.js`;

  try {
    const { stdout, stderr } = await execFileAsync(
      "node",
      [scriptPath, ...args],
      {
        timeout: 30_000,      // 30s timeout
        maxBuffer: 1024 * 512 // 512KB output cap
      }
    );
    return stdout + (stderr ? `\n[stderr]: ${stderr}` : "");
  } catch (err: any) {
    if (err.code === "ERR_CHILD_PROCESS_TIMEOUT") {
      return `[error]: Skill ${skillName} timed out after 30s`;
    }
    return `[error]: ${err.message}`;
  }
}
```

### Pattern 6: MCP fetch Tool (added to Phase 2 MCP server)

**What:** New tool on the MCP server that proxies HTTP/HTTPS requests. Agent calls `fetch` tool; MCP server validates domain, makes request, returns response.

```typescript
// Source: MCP TypeScript SDK docs + CONTEXT.md decisions
// Added to Phase 2 MCP server codebase (mcp/src/tools/fetch.ts)
server.registerTool(
  "fetch",
  {
    title: "Fetch URL",
    description: "Fetch content from a URL. Subject to domain allowlist.",
    inputSchema: z.object({
      url: z.string().url(),
      method: z.enum(["GET", "POST"]).default("GET"),
      headers: z.record(z.string()).optional(),
      body: z.string().optional()
    })
  },
  async ({ url, method, headers, body }) => {
    const allowed = isAllowedDomain(url);  // checks ALLOWED_DOMAINS or ALLOW_ALL_DOMAINS
    if (!allowed) {
      return { content: [{ type: "text", text: `[error]: Domain not in allowlist` }] };
    }
    const res = await fetch(url, { method, headers, body });
    const text = await res.text();
    return { content: [{ type: "text", text: text.slice(0, 100_000) }] };
  }
);
```

### Dockerfile Pattern

```dockerfile
# agent/Dockerfile.base
FROM node:22-alpine AS base

# Create non-root user
RUN addgroup -S agent && adduser -S agent -G agent

WORKDIR /app

# Copy package files and install deps at build time
COPY package*.json ./
RUN npm ci --only=production

COPY src/ ./src/

# Read-only mount point for agent profile (AGENT.md, skills/)
RUN mkdir -p /app/agent && chown agent:agent /app/agent

# Writable tmpfs targets — declared here but mounted at runtime
RUN mkdir -p /app/workspace /tmp

USER agent

ENTRYPOINT ["node", "src/entrypoint.js"]
```

```dockerfile
# agent/Dockerfile.claude
FROM base AS claude
# @anthropic-ai/sdk already in package.json
ENV AGENT_LLM_PROVIDER=claude
```

### Anti-Patterns to Avoid

- **Shell: true in execFile:** Never use `shell: true` when invoking skill scripts — shell injection risk with dynamic args
- **Installing npm packages at container start:** Defeats pre-built image model and creates network dependency at runtime
- **Embedding API keys in Dockerfile or image layers:** Use Docker secrets (`/run/secrets/`) and read at runtime only
- **Storing conversation history in container filesystem:** Violates read-only rootfs and ephemeral design; use MCP/DB instead
- **Using root user in agent container:** Always run as non-root; `cap_drop: ALL` with root user is still dangerous

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MCP protocol client | Custom HTTP client parsing MCP JSON-RPC | Anthropic MCP connector beta OR `@modelcontextprotocol/sdk` | Protocol has auth, session management, error handling edge cases |
| YAML frontmatter parsing | Regex-based YAML extraction | `js-yaml` | YAML has many valid syntax forms; regex will miss edge cases |
| HTTP fetch with domain filtering | Custom fetch wrapper | Node built-in `fetch` + simple domain extraction | Native fetch is sufficient; domain check is trivial string parsing |
| Agentic loop termination | Custom `stop_reason` state machine | SDK standard `stop_reason: "end_turn"` check | SDK handles all stop reasons; hand-rolling misses edge cases |
| Capability dropping logic | Custom seccomp policy from scratch | Docker default seccomp + `cap_drop: ALL` | Docker's default seccomp already blocks ~44 dangerous syscalls |

**Key insight:** The MCP connector beta is the right choice for the Claude provider path — it eliminates the need to manage a local MCP client, transport layer, and tool dispatch. The tradeoff is the HTTPS requirement for the server URL, which needs verification in local Docker networking.

---

## Common Pitfalls

### Pitfall 1: MCP Connector Requires HTTPS URL

**What goes wrong:** The Anthropic MCP connector beta `mcp_servers[].url` field states it "Must start with https://". In local Docker compose networking, the MCP server is on `http://mcp:3000`. The connector may reject the plaintext URL.

**Why it happens:** The connector is designed for remote MCP servers over the public internet.

**How to avoid:** Two options:
1. Add a local TLS termination (nginx/traefik) in front of the MCP service for the agent to connect to.
2. Use the `@modelcontextprotocol/sdk` TypeScript client helpers (`mcpTools`, `mcpMessages`) with a `StreamableHttpClientTransport` instead of the connector — this supports plaintext HTTP and runs in-process.

**Warning signs:** 400 or validation error when agent starts up trying to connect to MCP.

### Pitfall 2: read_only Rootfs + npm Caching

**What goes wrong:** `npm ci` inside a container with read-only rootfs tries to write to `~/.npm` cache, fails.

**Why it happens:** npm caching is implicit and writes outside the project directory.

**How to avoid:** All `npm install` / `npm ci` runs in the Dockerfile — never at container runtime. Use `--cache /tmp/npm-cache` or set `npm config set cache /tmp` in Dockerfile before the install step, then remove the cache layer.

### Pitfall 3: gVisor Not Available on macOS

**What goes wrong:** Operator on macOS tries to use `strict` profile, gets error that `runsc` runtime is not found.

**Why it happens:** gVisor requires a Linux kernel (4.14.77+). macOS uses a Linux VM for Docker Desktop, but the VM doesn't have gVisor pre-installed.

**How to avoid:** Document clearly that `strict` profile requires manual gVisor installation on a Linux host. `standard` profile (default) is the macOS-compatible path. Compose `profiles` gate keeps the `strict` service from starting unless explicitly requested.

### Pitfall 4: Skill Scripts With Missing Dependencies

**What goes wrong:** Agent tries to run a skill script; `node run.js` fails because it imports a module not in the container's `node_modules`.

**Why it happens:** Each agent profile's `package.json` must list all skill dependencies. If a new skill is added without updating `package.json` and rebuilding the image, the runtime fails.

**How to avoid:** Each agent profile directory owns a `package.json`. The Dockerfile copies and installs it. Workflow: add skill → update `package.json` → rebuild image.

### Pitfall 5: Tool Result Ordering in Anthropic API

**What goes wrong:** Sending a message with `tool_result` content blocks after text content blocks causes a 400 API error.

**Why it happens:** Anthropic API requires `tool_result` blocks to come FIRST in the user message content array — any text must come after all tool results.

**How to avoid:** When constructing tool result messages, always prepend `tool_result` blocks before any `text` blocks. This is a non-obvious API constraint.

### Pitfall 6: Container Restart Clears Workspace

**What goes wrong:** Agent stores working data in `/app/workspace` (tmpfs), container crashes and restarts, data is gone.

**Why it happens:** tmpfs is in-memory and ephemeral by design — this is intentional.

**How to avoid:** This is a feature, not a bug. Document it explicitly in AGENT.md: "Use MCP tools to persist any data that must survive restarts." If a specific workflow genuinely needs workspace persistence, add it as a named volume in a separate compose profile.

---

## Code Examples

### Skill SKILL.md Format

```markdown
---
name: web-search
description: Search the web for current information using the MCP fetch tool
---

# Web Search Skill

Use the `fetch` MCP tool to retrieve web content. This skill provides patterns
for constructing search queries and parsing results.

## Usage

Call `node /app/agent/skills/web-search/run.js <query>` to execute a search.

## Notes

- Always check that the domain is in the fetch allowlist before calling
- Prefer official documentation URLs over aggregator sites
```

### Entrypoint Script Pattern

```typescript
// agent/src/entrypoint.ts
import fs from "node:fs";
import { buildSkillIndex } from "./skills.js";
import { startAgentLoop } from "./agent.js";

const AGENT_DIR = "/app/agent";
const agentMd = fs.readFileSync(`${AGENT_DIR}/AGENT.md`, "utf8");
const skillIndex = buildSkillIndex(`${AGENT_DIR}/skills`);

// Inject skill index into system prompt
const systemPrompt = agentMd.replace(
  "{{SKILL_INDEX}}",
  skillIndex || "(no repo skills loaded)"
);

// Start reading from stdin
process.stdin.setEncoding("utf8");
let buffer = "";
process.stdin.on("data", chunk => {
  buffer += chunk;
  if (buffer.includes("\n")) {
    const input = buffer.trim();
    buffer = "";
    startAgentLoop(systemPrompt, input).then(response => {
      process.stdout.write(response + "\n> ");
    });
  }
});
process.stdout.write("> ");
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| MCP SSE transport | MCP Streamable HTTP transport | 2025 (MCP spec update) | Phase 2 already uses Streamable HTTP — consistent |
| MCP connector `mcp-client-2025-04-04` | MCP connector `mcp-client-2025-11-20` | Nov 2025 | Tool config moved from server definition to `tools[]` array; old beta header is deprecated |
| `Nono` sandbox tool | Not a real package — does not exist | N/A | Confirmed non-existent. The CONTEXT.md "Nono or gVisor" phrasing is aspirational. Use Docker seccomp + cap_drop for standard; gVisor for strict |

**Deprecated/outdated:**
- `mcp-client-2025-04-04` beta header: Deprecated, replaced by `mcp-client-2025-11-20`. Do not use.
- `tool_configuration.allowed_tools` in mcp_servers: Deprecated field, use MCPToolset in `tools[]` array instead.

---

## Open Questions

1. **MCP connector HTTP vs HTTPS requirement**
   - What we know: Anthropic MCP connector docs say URL "Must start with https://"
   - What's unclear: Whether this is enforced by the API or just a recommendation; whether local Docker HTTP URLs are accepted in practice
   - Recommendation: In Wave 0 or the first agent task, test connecting to `http://mcp:3000/mcp`. If rejected, fall back to using `@modelcontextprotocol/sdk` with `StreamableHttpClientTransport` for the Claude provider. Document which path was taken.

2. **Seccomp profile content for `standard` sandbox**
   - What we know: Docker default seccomp blocks ~44 syscalls. Custom profiles use JSON format.
   - What's unclear: Whether Docker default seccomp is sufficient, or if we need a custom profile for the specific Node.js workload
   - Recommendation: Start with `seccomp:unconfined` to verify the agent works, then apply `seccomp:/path/to/default.json` (Docker's default profile, downloadable from Docker GitHub), then tighten from there. Claude's discretion as noted in CONTEXT.md.

3. **Capabilities to drop for Node.js agent**
   - What we know: `cap_drop: ALL` is the baseline. Node.js typically needs no Linux capabilities for application work.
   - What's unclear: Whether any skill scripts might need specific capabilities (unlikely but possible)
   - Recommendation: Start with `cap_drop: ALL` and no `cap_add`. If a specific skill genuinely needs a capability, add it explicitly with a comment explaining why.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None detected — Wave 0 creates it |
| Config file | `agent/jest.config.ts` (Wave 0) |
| Quick run command | `docker compose run --rm agent npm test -- --testPathPattern=unit` |
| Full suite command | `docker compose run --rm agent npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AGT-01 | Container starts with read-only rootfs and dropped caps | smoke | `docker compose run --rm agent sh -c "touch /test 2>&1 \| grep -q 'Read-only' && echo PASS"` | Wave 0 |
| AGT-01 | tmpfs /app/workspace is writable | smoke | `docker compose run --rm agent sh -c "touch /app/workspace/test && echo PASS"` | Wave 0 |
| AGT-01 | No-new-privileges prevents setuid escalation | smoke | `docker compose run --rm agent sh -c "su - root 2>&1 \| grep -q 'Permission denied' && echo PASS"` | Wave 0 |
| AGT-02 | AGENT.md loads and skill index injected into prompt | unit | `docker compose run --rm agent npm test -- --testPathPattern=entrypoint` | Wave 0 |
| AGT-03 | Skill SKILL.md frontmatter parses correctly | unit | `docker compose run --rm agent npm test -- --testPathPattern=skills` | Wave 0 |
| AGT-03 | Skill script executes and returns stdout | unit | `docker compose run --rm agent npm test -- --testPathPattern=skills` | Wave 0 |
| AGT-03 | Skill execution timeout enforced | unit | `docker compose run --rm agent npm test -- --testPathPattern=skills` | Wave 0 |
| AGT-04 | npm install succeeds during image build | smoke | `docker compose build agent` | Wave 0 (Dockerfile) |

### Sampling Rate
- **Per task commit:** `docker compose build agent && docker compose run --rm agent npm test -- --testPathPattern=unit`
- **Per wave merge:** `docker compose build agent && docker compose run --rm agent npm test`
- **Phase gate:** Full suite green + manual sandbox escape verification before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `agent/src/__tests__/skills.test.ts` — covers AGT-03 (skill loading, index building, execFile)
- [ ] `agent/src/__tests__/entrypoint.test.ts` — covers AGT-02 (AGENT.md loading, prompt injection)
- [ ] `agent/jest.config.ts` — test framework configuration
- [ ] `agent/tsconfig.json` — TypeScript configuration (if not already present)
- [ ] Sandbox smoke test script: `scripts/test-sandbox.sh` — covers AGT-01 escape verification

---

## Sources

### Primary (HIGH confidence)
- `https://platform.claude.com/docs/en/agents-and-tools/mcp-connector` — MCP connector beta API, `mcp-client-2025-11-20` schema, TypeScript examples
- `https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls` — tool_result formatting requirements, is_error, ordering constraint
- `https://docs.docker.com/compose/compose-file/05-services/` — security_opt, cap_drop, read_only, tmpfs, runtime fields
- `https://docs.docker.com/compose/compose-file/deploy/` — resources.limits (cpus, memory), restart_policy
- `https://docs.docker.com/engine/security/seccomp/` — seccomp profile format and application
- `https://nodejs.org/api/child_process.html` — execFile timeout, maxBuffer, error codes
- gVisor GitHub README — Linux-only, x86_64/ARM64, requires Linux 4.14.77+

### Secondary (MEDIUM confidence)
- `https://github.com/modelcontextprotocol/typescript-sdk` — registerTool() pattern with Zod schema; docs/server.md referenced but not directly fetched
- `https://docs.docker.com/engine/containers/run/` — cap_drop, cap_add patterns

### Tertiary (LOW confidence)
- "Nono" as a sandbox tool: searched and confirmed non-existent as an npm/container sandbox package. The CONTEXT.md phrasing "Nono or gVisor" is treated as gVisor being the strict profile option; Nono is not pursued.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — official SDK docs, official Docker Compose spec
- Architecture: HIGH — derived directly from locked CONTEXT.md decisions + verified API patterns
- Pitfalls: HIGH for MCP/API pitfalls (official docs); MEDIUM for sandbox edge cases (reasoning from docs)
- Validation: MEDIUM — test commands inferred from architecture; no existing test infra found

**Research date:** 2026-03-27
**Valid until:** 2026-04-27 (stable APIs) — but verify MCP connector beta header currency before implementation
