# Phase 5: Privacy and Compliance - Context

**Gathered:** 2026-03-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Operators have full visibility into the platform's external communications and security posture. Deliverables: SECURITY.md (threat model, data flow, guarantees, callout inventory, open questions), `security-audit.sh` script that validates guarantees at runtime, `network-audit.sh` script for network exposure analysis. Covers PRV-01, PRV-02, PRV-03.

</domain>

<decisions>
## Implementation Decisions

### External Callout Documentation (PRV-01)
- Single SECURITY.md at repo root — all security/privacy info in one file
- Full detail per callout entry: destination host, port, protocol, purpose, which service, when it fires, what data is sent, whether optional
- Block/disable instructions per callout (e.g., "switch to Ollama for air-gapped operation")
- Covers all containers (MCP + agent + any other), not just MCP
- For agent container callouts that vary by config: document the pattern (agent calls LLM via env-configured provider), not every possible provider
- `./talos security-audit` command verifies actual runtime callouts against documented list — catches drift
- Mermaid data flow diagram showing container boundaries and network paths

### Threat Model
- Explicit threat model section enumerating known attack surfaces
- Each attack surface includes: description, mitigations in place, residual risk
- Covers: agent escape, MCP injection, credential leakage, embedding data exfiltration, etc.
- Describe security controls factually — no compliance framework mapping (operators map to their own framework)

### Network Exposure Indication (PRV-03)
- Summary pass/fail in health.sh for network posture
- Detailed `./talos network-audit` command (new `scripts/network-audit.sh`)
- Network audit checks: published ports/bindings, container network membership, DNS/outbound reachability, compose config drift
- Combined approach: pass/fail verdict for known baselines + full report of current state for operator interpretation
- Integrated into `./talos` CLI wrapper as `./talos network-audit`

### Security Assumption Tracking (PRV-02)
- "Open Security Questions" section in SECURITY.md — prominent, visible before deployment
- Each security guarantee tagged with machine-checkable assertion (e.g., `[CHECK: rls-enabled]`)
- `security-audit.sh` maps tags to runtime checks — validates guarantees are actively true
- Per-control granularity: one guarantee per security control (~10-15 items)
- Resolved assumptions get removed from the doc (no archive section)
- Documented warning model — "deploy at your own risk" for open questions, no enforcement gate

### Documentation Structure
- Single SECURITY.md (not index + sub-docs)
- Section order: 1) Threat model & attack surfaces, 2) Data flow diagram, 3) Security guarantees (with CHECK tags), 4) External callout inventory, 5) Open security questions/assumptions
- Audience: security auditor (formal, thorough)
- No README.md link — SECURITY.md is a GitHub convention, auditors find it
- New `scripts/security-audit.sh` (separate from health.sh — health = running, security = secure)
- Human-readable output with `--json` flag for CI

### Claude's Discretion
- Specific threat model attack surface enumeration (based on codebase audit)
- Which security guarantees to include and their CHECK tag names
- Data flow diagram layout and detail level
- Security-audit script implementation approach
- How to detect compose config drift vs running state

</decisions>

<specifics>
## Specific Ideas

- Security-audit script should check that known guarantees are actively true at runtime, not just read from the doc
- SECURITY.md tracks both verified guarantees AND unanswered questions/assumptions
- Tagged assertions keep doc and script in sync — `[CHECK: tag]` in doc maps to a check function in script
- Claude should audit the codebase to surface all unresolved security assumptions (sandbox strength, credential handling, network boundaries, etc.)

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `scripts/health.sh`: Already checks network isolation, RLS, service reachability — network summary section can extend this
- `scripts/audit.sh`: Query script with `--json` flag pattern — reuse for security-audit output format
- `./talos` CLI wrapper: Already routes to health, audit, status — add security-audit and network-audit routes

### Established Patterns
- Phase 4: Shell scripts in `scripts/` with `./talos` wrapper routing
- Phase 4: `--json` flag for machine-readable output alongside human-readable default
- Phase 4: health.sh uses `check()` function pattern with pass/fail verdicts

### Integration Points
- `scripts/health.sh` — add network posture summary section
- `./talos` wrapper — add `security-audit` and `network-audit` subcommands
- `mcp/src/providers/` — OpenAI, OpenRouter, Ollama adapters are the external callouts to document
- `agent/src/agent.ts` — agent LLM API calls to document
- `docker-compose.yml` — network topology for data flow diagram and network-audit baseline

</code_context>

<deferred>
## Deferred Ideas

- Agentic security auditor skill — an agent that reads SECURITY.md, runs security-audit, and reports compliance gaps autonomously
- Opt-in enforcement gate (`--strict` flag making open assumptions fail the security-audit check)
- Compliance framework hints (SOC2, GDPR mapping) — if needed for enterprise adoption later

</deferred>

---

*Phase: 05-privacy-and-compliance*
*Context gathered: 2026-03-28*
