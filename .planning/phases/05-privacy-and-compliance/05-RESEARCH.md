# Phase 5: Privacy and Compliance - Research

**Researched:** 2026-03-28
**Domain:** Security documentation, shell-based runtime auditing, Docker network analysis
**Confidence:** HIGH (codebase-derived; all findings from direct source inspection)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**External Callout Documentation (PRV-01)**
- Single SECURITY.md at repo root — all security/privacy info in one file
- Full detail per callout entry: destination host, port, protocol, purpose, which service, when it fires, what data is sent, whether optional
- Block/disable instructions per callout (e.g., "switch to Ollama for air-gapped operation")
- Covers all containers (MCP + agent + any other), not just MCP
- For agent container callouts that vary by config: document the pattern (agent calls LLM via env-configured provider), not every possible provider
- `./talos security-audit` command verifies actual runtime callouts against documented list — catches drift
- Mermaid data flow diagram showing container boundaries and network paths

**Threat Model**
- Explicit threat model section enumerating known attack surfaces
- Each attack surface includes: description, mitigations in place, residual risk
- Covers: agent escape, MCP injection, credential leakage, embedding data exfiltration, etc.
- Describe security controls factually — no compliance framework mapping

**Network Exposure Indication (PRV-03)**
- Summary pass/fail in health.sh for network posture
- Detailed `./talos network-audit` command (new `scripts/network-audit.sh`)
- Network audit checks: published ports/bindings, container network membership, DNS/outbound reachability, compose config drift
- Combined approach: pass/fail verdict for known baselines + full report of current state
- Integrated into `./talos` CLI wrapper as `./talos network-audit`

**Security Assumption Tracking (PRV-02)**
- "Open Security Questions" section in SECURITY.md — prominent, visible before deployment
- Each security guarantee tagged with machine-checkable assertion (e.g., `[CHECK: rls-enabled]`)
- `security-audit.sh` maps tags to runtime checks — validates guarantees are actively true
- Per-control granularity: one guarantee per security control (~10-15 items)
- Resolved assumptions get removed from the doc (no archive section)
- Documented warning model — "deploy at your own risk" for open questions, no enforcement gate

**Documentation Structure**
- Single SECURITY.md (not index + sub-docs)
- Section order: 1) Threat model & attack surfaces, 2) Data flow diagram, 3) Security guarantees (with CHECK tags), 4) External callout inventory, 5) Open security questions/assumptions
- Audience: security auditor (formal, thorough)
- No README.md link — SECURITY.md is a GitHub convention, auditors find it
- New `scripts/security-audit.sh` (separate from health.sh)
- Human-readable output with `--json` flag for CI

### Claude's Discretion
- Specific threat model attack surface enumeration (based on codebase audit)
- Which security guarantees to include and their CHECK tag names
- Data flow diagram layout and detail level
- Security-audit script implementation approach
- How to detect compose config drift vs running state

### Deferred Ideas (OUT OF SCOPE)
- Agentic security auditor skill
- Opt-in enforcement gate (`--strict` flag)
- Compliance framework hints (SOC2, GDPR mapping)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PRV-01 | All external callouts (embedding APIs, cloud services) explicitly documented and visible to operator | Full callout inventory catalogued below from codebase inspection; security-audit.sh CHECK tags enforce it at runtime |
| PRV-02 | Any assumption impacting privacy or security is a blocking issue until documented and resolved | Open Security Questions section in SECURITY.md + CHECK tag mechanism links doc to runtime verification |
| PRV-03 | Operator knows at all times whether infrastructure is exposed to public/uncontrolled resources | network-audit.sh checks published ports, network memberships, DNS reachability, compose drift; health.sh gets network posture summary |
</phase_requirements>

---

## Summary

Phase 5 is entirely a documentation and tooling phase — no new application code. The deliverables are: `SECURITY.md` (threat model, data flow diagram, guarantees with CHECK tags, callout inventory, open questions), `scripts/security-audit.sh` (runtime verifier mapping CHECK tags to actual checks), and `scripts/network-audit.sh` (network exposure analyzer). The `./talos` wrapper gets two new subcommands. `scripts/health.sh` gets a network posture summary section.

All content for these deliverables can be derived from the existing codebase. The external callout inventory is fully known from source inspection. The security controls (RLS, seccomp, network topology, secrets) are implemented and verifiable. The threat model surfaces are identifiable from the architecture.

**Primary recommendation:** Write SECURITY.md from codebase facts, implement CHECK tag pattern borrowed from audit.sh's `--json` pattern, and implement network-audit.sh using `docker inspect` + `docker compose config` for drift detection.

---

## Codebase Findings (Source of Truth for All Content)

### External Callouts — Complete Inventory

| Container | Destination | Host | Port | Protocol | Purpose | Trigger | Data Sent | Optional? |
|-----------|-------------|------|------|----------|---------|---------|-----------|-----------|
| mcp | OpenRouter API | `openrouter.ai` | 443 | HTTPS | Embedding generation | Any insert or update MCP tool call | Text content to embed (chunks up to CHUNK_SIZE chars) | Yes — set `EMBEDDING_PROVIDER=ollama` for local |
| mcp | OpenAI API | `api.openai.com` | 443 | HTTPS | Embedding generation | Any insert or update MCP tool call | Text content to embed | Yes — set `EMBEDDING_PROVIDER=ollama` for local |
| mcp | Ollama instance | configurable via `OLLAMA_BASE_URL` | configurable | HTTP | Embedding generation (local) | Any insert or update MCP tool call | Text content to embed | No external call — self-hosted |
| agent | Anthropic API | `api.anthropic.com` | 443 | HTTPS | LLM inference (reasoning + tool selection) | Every agent turn (prompt + tool results) | Full conversation history, system prompt, tool definitions | Yes — other LLM providers can be added; only Claude implemented |
| agent | MCP server (internal) | `mcp` (Docker DNS) | 3000 | HTTP | Tool execution | Agent tool use blocks | Tool name + arguments | No — required for agent function |

**Air-gapped operation:** Set `EMBEDDING_PROVIDER=ollama` + point `AGENT_LLM_PROVIDER` to a local model. Only Ollama embedding is fully local today; no local LLM provider is implemented (Claude only).

**What is NOT sent externally:**
- Database contents (only embeddings via MCP)
- Agent API keys or secrets
- Raw Postgres queries
- Audit log data

### Security Controls — Verified in Codebase

| Control | Implementation | Location | Verifiable at Runtime |
|---------|---------------|----------|-----------------------|
| Row-Level Security | `FORCE ROW LEVEL SECURITY` on `entries` and `audit_log` | `db/init/06-rls.sql` | `SELECT rowsecurity FROM pg_tables` — already in health.sh |
| Non-superuser DB role | `mcp_service` role with limited grants | `db/init/02-roles.sql` | Query `pg_roles` |
| Agent network isolation | Agent on `frontend` only; DB on `backend` only; MCP bridges both | `docker-compose.yml` networks section | `docker inspect` network membership |
| Read-only agent filesystem | `read_only: true` + tmpfs for `/app/workspace` and `/tmp` | `docker-compose.yml` agent service | `docker inspect` mounts |
| No-new-privileges | `no-new-privileges:true` security_opt | `docker-compose.yml` | `docker inspect` SecurityOpt |
| Seccomp profile | Custom `agent/seccomp-standard.json` (Docker default v28.0.1 base) | `docker-compose.yml` security_opt | `docker inspect` SecurityOpt |
| All Linux caps dropped | `cap_drop: ALL` | `docker-compose.yml` | `docker inspect` CapDrop |
| Secrets as files | Docker secrets mounted at `/run/secrets/` | `docker-compose.yml` secrets section | Files exist at runtime |
| CPU/memory limits | `cpus: 1.0`, `memory: 512M` (agent) | `docker-compose.yml` deploy.resources | `docker stats` |
| Audit logging | Trigger-based writes to `audit_log` for all mutations | `db/init/07-audit.sql` | Table exists + RLS check |
| Bearer token auth (MCP) | Agent key required in Authorization header | `agent/src/providers/claude.ts` + MCP server | Runtime request headers |

### Network Topology (from docker-compose.yml)

```
Internet
    |
    | HTTPS/443
    v
[mcp container] --- backend network --> [db container :5432]
       ^                                      (no internet access)
       |
  frontend network
       |
[agent container] --> HTTPS/443 --> Anthropic API
```

Networks:
- `backend`: db + mcp only. db is NOT reachable from agent.
- `frontend`: mcp + agent. Agent cannot reach db.
- `db` published port: `${DB_PORT:-5432}:5432` — **this is a finding**: DB is exposed on host by default.

**Published ports (default compose):**
- db: `${DB_PORT:-5432}:5432` — Postgres accessible on host loopback (or all interfaces depending on host Docker config)
- mcp: no published port in docker-compose.yml
- agent: no published port

**This is a PRV-03 finding to document:** DB port is published to host by default. Operators on a multi-tenant host should bind to `127.0.0.1:5432` or remove the port mapping.

### Unresolved Security Assumptions (Open Questions for SECURITY.md)

1. **DB port exposure**: `ports: "${DB_PORT:-5432}:5432"` publishes Postgres to the host. Docker binds to `0.0.0.0` by default unless the host daemon is configured otherwise. This is intentional for local dev but risky in production.

2. **Seccomp profile strength**: `agent/seccomp-standard.json` is described as Docker default v28.0.1 in comments. The actual restrictiveness relative to a hardened profile is not verified in code review.

3. **gVisor availability**: `agent-strict` profile uses `runtime: runsc` (gVisor). This requires gVisor installed on the Linux host. No install verification exists. The default `agent` profile does NOT use gVisor.

4. **Anthropic stub not disabled**: `mcp/src/providers/anthropic.ts` exists and throws at runtime. An operator who sets `EMBEDDING_PROVIDER=anthropic` gets a silent runtime failure, not a startup error.

5. **Agent outbound network not restricted**: The `frontend` network has no egress filtering. The agent container can reach any internet host, not just `api.anthropic.com`. This is a Docker limitation without additional tooling (iptables/nftables rules outside compose).

6. **MCP not TLS-terminated**: MCP uses plain HTTP on the `frontend` network. This is acceptable for a Docker internal network but is a residual risk if network segmentation fails.

7. **DB authentication**: `db/init/00-configure.sh` uses trust auth for local connections (pg_dump). The `pg_hba.conf` configuration is inherited from the container image default except where init scripts modify it — exact final state of `pg_hba.conf` is not fully audited.

---

## Standard Stack

### Core (all pre-existing — no new dependencies needed)

| Tool | Version | Purpose | Notes |
|------|---------|---------|-------|
| bash | system | `security-audit.sh`, `network-audit.sh` | Match existing script pattern |
| docker CLI | 20+ | Container inspection in audit scripts | `docker inspect`, `docker network inspect` |
| docker compose CLI | v2 | Compose config diff | `docker compose config` for drift detection |
| psql | via compose exec | DB-level security checks | Already used in health.sh |

No new npm packages, no new containers, no new language runtimes needed.

### Established Project Patterns to Reuse

| Pattern | Where It Lives | How to Reuse |
|---------|---------------|-------------|
| `check()` function with PASS/FAIL counters | `scripts/health.sh` lines 12-21 | Copy verbatim into security-audit.sh and network-audit.sh |
| `--json` flag with `FORMAT` variable | `scripts/audit.sh` lines 15, 57-62 | Copy pattern for machine-readable output |
| `$COMPOSE exec -T db psql` for DB checks | `scripts/health.sh` | Use for DB security checks (RLS, roles, etc.) |
| `./talos` routing via `case` statement | `talos` wrapper | Add `security-audit` and `network-audit` cases |

---

## Architecture Patterns

### CHECK Tag Pattern (PRV-02 Core Mechanism)

This is the linchpin of the implementation. Each security guarantee in SECURITY.md has a machine-readable tag:

```
| RLS enforced on all data tables | `[CHECK: rls-entries]` |
```

`security-audit.sh` has a corresponding check function named after the tag:

```bash
check_rls_entries() {
  $COMPOSE exec -T db psql -U postgres -d talos -tAc \
    "SELECT rowsecurity FROM pg_tables WHERE tablename='entries'" | grep -q t
}
```

The script iterates all CHECK tags and runs the matching function. If a tag exists in the doc but no function exists, it is flagged as unimplemented. This keeps documentation and runtime in sync.

### Network Audit Approach (PRV-03)

`docker inspect` is the authoritative source for runtime container configuration. Key checks:

```bash
# Published ports
docker inspect talos-db-1 --format '{{json .NetworkSettings.Ports}}'

# Network membership
docker inspect talos-agent-1 --format '{{json .NetworkSettings.Networks}}'

# Security options (seccomp, no-new-privileges)
docker inspect talos-agent-1 --format '{{json .HostConfig.SecurityOpt}}'

# Read-only rootfs
docker inspect talos-agent-1 --format '{{.HostConfig.ReadonlyRootfs}}'

# Capabilities dropped
docker inspect talos-agent-1 --format '{{json .HostConfig.CapDrop}}'
```

Compose config drift detection:

```bash
# Canonical config (what compose WOULD deploy)
docker compose -f docker-compose.yml config > /tmp/canonical.yml

# Compare against running container labels
# docker compose stores config hash in container labels
docker inspect talos-agent-1 --format '{{index .Config.Labels "com.docker.compose.config-hash"}}'
```

### DNS/Outbound Reachability Check

To verify which containers can reach the internet:

```bash
# Test outbound from agent container
docker exec talos-agent-1 sh -c "nslookup api.anthropic.com 2>&1" || echo "No DNS"

# Test outbound from db container (should fail)
docker exec talos-db-1 sh -c "nslookup api.anthropic.com 2>&1" || echo "PASS: db cannot reach internet"
```

Note: `nslookup` may not be present in all images. Use `wget -q --spider --timeout=3 https://api.anthropic.com` as fallback.

### health.sh Network Posture Section (PRV-03 in health.sh)

Add a new section to `scripts/health.sh` after existing checks:

```bash
echo ""
echo "=== Network Posture ==="

# DB port published (expected, note exposure)
check "Agent cannot reach DB directly" \
  bash -c "! $COMPOSE exec -T agent sh -c 'nc -z db 5432 2>/dev/null'"

check "Agent on frontend network only" \
  bash -c "$COMPOSE exec -T agent sh -c 'hostname' | xargs docker inspect --format '{{range \$k,\$v := .NetworkSettings.Networks}}{{\$k}} {{end}}' 2>/dev/null | grep -v backend"
```

This is a lightweight summary — full analysis goes in `./talos network-audit`.

### Mermaid Data Flow Diagram

Based on docker-compose.yml network topology:

```
graph LR
  subgraph host["Host Machine"]
    subgraph frontend["Docker: frontend network"]
      A[agent container\nread-only fs\nseccomp\nno-cap]
      M[mcp container]
    end
    subgraph backend["Docker: backend network"]
      M
      D[(db container\nPostgres + pgvector)]
    end
    P[Host port 5432]
    D -->|published| P
  end
  A -->|HTTP :3000\nBearer token| M
  M -->|TCP :5432\nmcp_service role\nRLS enforced| D
  A -->|HTTPS :443\nAPI key| LLMAPI[Anthropic API\napi.anthropic.com]
  M -->|HTTPS :443\nAPI key| EMBAPI[Embedding API\nopenrouter.ai or\napi.openai.com]
  style LLMAPI fill:#f9f,stroke:#333
  style EMBAPI fill:#f9f,stroke:#333
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| Container runtime state | Custom proc/cgroup inspection | `docker inspect` JSON output |
| Compose drift detection | File diffing | `docker compose config` canonical output + compose config-hash label |
| DB security checks | Custom TCP probes | `$COMPOSE exec -T db psql` (already in health.sh) |

---

## Common Pitfalls

### Pitfall 1: CHECK Tag Names with Hyphens vs Underscores
**What goes wrong:** `[CHECK: rls-entries]` in SECURITY.md but function named `check_rls_entries()` in bash. Hyphen-to-underscore mapping must be consistent or the script cannot auto-map tags to functions.
**How to avoid:** Pick one convention (underscores in bash function names, hyphens in CHECK tags) and apply a `tr '-' '_'` transform when mapping tags to functions.

### Pitfall 2: docker inspect Requires Running Containers
**What goes wrong:** `network-audit.sh` calls `docker inspect talos-agent-1` but container name is not predictable — Docker Compose names containers `{project}_{service}_{n}` and the project name defaults to directory name.
**How to avoid:** Use `docker compose ps -q agent` to get container IDs, then pass those to `docker inspect`. Or use `$COMPOSE exec -T agent` for in-container checks.

### Pitfall 3: Conflating health.sh and security-audit.sh Scope
**What goes wrong:** Adding security checks to health.sh that require the stack to be in a specific secure state. health.sh is about "is it running?" — security-audit.sh is about "is it secure?".
**How to avoid:** health.sh gets only a lightweight network posture summary (2-3 checks). security-audit.sh gets full CHECK tag coverage. Keep them independent — security-audit.sh should be runnable without health.sh passing.

### Pitfall 4: DB Port Exposure Surprise
**What goes wrong:** `ports: "${DB_PORT:-5432}:5432"` in compose publishes Postgres to the host. Docker binds to `0.0.0.0` by default. This means Postgres is reachable from any interface on the host, not just localhost, unless the host firewall blocks it.
**How to avoid:** Document this explicitly in SECURITY.md callout inventory and the open questions section. The network-audit.sh should flag when DB port binding is `0.0.0.0:5432` vs `127.0.0.1:5432`.

### Pitfall 5: security-audit.sh Silently Skipping Failed Compose exec
**What goes wrong:** `$COMPOSE exec -T db psql` fails silently if the DB is not running. The check passes vacuously.
**How to avoid:** Add a pre-flight check at the start of security-audit.sh that verifies the stack is running before executing any checks. Exit early with a clear error if the stack is down.

---

## Code Examples

### check() Pattern (reuse from health.sh)

```bash
# Source: scripts/health.sh lines 12-21
PASS=0
FAIL=0

check() {
  local label="$1"; shift
  if "$@" &>/dev/null; then
    echo "[PASS] $label"
    PASS=$((PASS + 1))
  else
    echo "[FAIL] $label"
    FAIL=$((FAIL + 1))
  fi
}
```

### --json Flag Pattern (reuse from audit.sh)

```bash
# Source: scripts/audit.sh
FORMAT="human"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --json) FORMAT="json"; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Output:
if [[ "$FORMAT" == "json" ]]; then
  echo '{"passed": '"$PASS"', "failed": '"$FAIL"', "checks": [...]}'
else
  echo "Result: $PASS passed, $FAIL failed"
fi
```

### docker inspect Network Check

```bash
# Get container ID via compose (avoids hardcoded container name)
AGENT_ID=$($COMPOSE ps -q agent 2>/dev/null | head -1)
if [[ -z "$AGENT_ID" ]]; then
  echo "[SKIP] Agent not running"
else
  NETWORKS=$(docker inspect "$AGENT_ID" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}')
  echo "Agent networks: $NETWORKS"
fi
```

### Compose Container Name Resolution

```bash
# Portable way to get a running container ID from compose service name
get_container_id() {
  local service="$1"
  $COMPOSE ps -q "$service" 2>/dev/null | head -1
}
```

---

## Validation Architecture

`nyquist_validation: true` in config.json — this section is required.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None for shell scripts (bash -n syntax check + manual smoke tests) |
| Unit testing | N/A — shell scripts; use `bash -n script.sh` for syntax validation |
| Quick run | `bash -n scripts/security-audit.sh && bash -n scripts/network-audit.sh` |
| Integration test | `./talos security-audit` and `./talos network-audit` against running stack |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PRV-01 | SECURITY.md exists with callout inventory | smoke | `test -f SECURITY.md && grep -q 'openrouter.ai' SECURITY.md` | Wave 0 |
| PRV-01 | security-audit.sh runs without error | smoke | `./talos security-audit` | Wave 0 |
| PRV-02 | CHECK tags in SECURITY.md map to functions in security-audit.sh | smoke | `./talos security-audit` (exit code 0) | Wave 0 |
| PRV-02 | Open Security Questions section exists | smoke | `grep -q 'Open Security Questions' SECURITY.md` | Wave 0 |
| PRV-03 | network-audit.sh runs without error | smoke | `./talos network-audit` | Wave 0 |
| PRV-03 | health.sh includes network posture summary | smoke | `./talos health \| grep -q 'Network Posture'` | Wave 0 |
| PRV-03 | DB port exposure flagged when binding to 0.0.0.0 | smoke | `./talos network-audit \| grep -qiE 'port|binding'` | Wave 0 |

### Sampling Rate

- **Per task commit:** `bash -n scripts/security-audit.sh && bash -n scripts/network-audit.sh`
- **Per wave merge:** `./talos health` + `./talos security-audit` + `./talos network-audit`
- **Phase gate:** All three commands exit 0 before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] No existing automated tests for shell scripts — all checks are runtime smoke tests against a running stack
- [ ] `bash -n` syntax check is the only pre-runtime validation available
- [ ] Full integration tests require `docker compose up` to be running

*(No framework install needed — bash is already present)*

---

## Open Questions

1. **Container name portability**
   - What we know: Docker Compose names containers `{project}_{service}_{n}` and project defaults to directory name (`talos`)
   - What's unclear: Should scripts use `docker compose ps -q` (portable) or hardcode `talos-db-1` (fragile)?
   - Recommendation: Use `$COMPOSE ps -q <service>` throughout both new scripts. Consistent with `$COMPOSE exec -T` pattern already used in health.sh.

2. **nslookup/nc availability in containers**
   - What we know: Agent uses a Node.js image; db uses pgvector/pgvector:pg17; mcp uses Node.js image
   - What's unclear: Whether `nc`, `nslookup`, or `wget` are available in each image for outbound reachability tests
   - Recommendation: Use `wget` (available in most Alpine/Debian Node images) with `--timeout=3 --spider -q` as the outbound test tool. Fall back to `/dev/tcp` bash builtin if wget is absent.

3. **Seccomp profile audit depth**
   - What we know: `agent/seccomp-standard.json` exists and is referenced in compose; described as Docker default v28.0.1 in code comments
   - What's unclear: Whether the actual JSON content is the full Docker default or a custom subset
   - Recommendation: Claude should read `agent/seccomp-standard.json` during planning/implementation and document the actual syscall whitelist depth in SECURITY.md.

---

## Sources

### Primary (HIGH confidence)
- `docker-compose.yml` — network topology, security_opt, published ports, secrets, resource limits
- `mcp/src/providers/openai.ts` — OpenAI callout endpoint and data shape
- `mcp/src/providers/openrouter.ts` — OpenRouter callout endpoint and data shape
- `mcp/src/providers/ollama.ts` — Ollama callout (local, configurable base URL)
- `mcp/src/providers/anthropic.ts` — Anthropic stub (throws at runtime, not a real callout)
- `agent/src/providers/claude.ts` — Anthropic API callout for LLM inference
- `scripts/health.sh` — existing check() pattern and PASS/FAIL mechanics
- `scripts/audit.sh` — existing --json flag pattern
- `talos` wrapper — existing subcommand routing

### Secondary (MEDIUM confidence)
- Docker documentation: `docker inspect` JSON output format for NetworkSettings, HostConfig
- Docker Compose documentation: `docker compose ps -q` for container ID resolution

---

## Metadata

**Confidence breakdown:**
- Callout inventory: HIGH — directly read from provider source files
- Security controls: HIGH — directly read from docker-compose.yml and db/init/
- Shell script patterns: HIGH — directly read from existing health.sh and audit.sh
- Network audit implementation: MEDIUM — docker inspect approach is standard but container name resolution needs validation
- Threat model: MEDIUM — surfaces identified from architecture; severity ratings are judgment calls

**Research date:** 2026-03-28
**Valid until:** 2026-04-28 (stable domain — Docker Compose API and shell scripting patterns do not change rapidly)
