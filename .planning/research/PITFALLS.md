# Domain Pitfalls

**Domain:** Self-hosted agentic AI platform with semantic PostgreSQL
**Researched:** 2026-03-27
**Confidence:** MEDIUM (training data only, no web verification available)

## Critical Pitfalls

Mistakes that cause rewrites or major security incidents.

### Pitfall 1: Embedding Dimension Mismatch Silently Corrupts Search

**What goes wrong:** You store embeddings with dimension 1536 (OpenAI ada-002), then switch providers to one producing 768-dim vectors. pgvector does not reject mismatched dimensions if the column is defined as `vector` without a fixed size. Cosine similarity returns nonsensical results with no error.
**Why it happens:** The "provider-agnostic" embedding layer makes switching easy, but nobody validates that existing data matches the new provider's output dimensions.
**Consequences:** All semantic search degrades silently. No errors, just bad results. Users blame the agent, not the embeddings.
**Prevention:**
- Always define the column with explicit dimensions: `vector(1536)` not `vector`. Postgres will reject mismatched inserts.
- Store the embedding model name and dimension in a metadata table. The MCP server checks on startup that the configured provider matches stored metadata.
- If provider changes, require an explicit re-embedding migration.
**Detection:** Semantic search returns irrelevant results. Cosine similarities cluster near 0 instead of a spread.
**Phase:** Must be addressed in Phase 1 (DB schema design). Retrofitting dimension constraints on a populated table is painful.

### Pitfall 2: RLS Policies That Look Secure But Bypass on Service Role

**What goes wrong:** You design RLS policies for per-agent isolation, but the MCP server connects with a superuser or `service_role` that bypasses RLS entirely. Every agent can read every other agent's data through the MCP server.
**Why it happens:** PostgreSQL RLS is bypassed by table owners and superusers by default. The `FORCE ROW LEVEL SECURITY` flag on the table is required even for table owners. Most tutorials skip this.
**Consequences:** Complete data isolation failure. One compromised agent reads all data.
**Prevention:**
- MCP server connects as a non-superuser, non-owner role (e.g., `mcp_app`).
- Apply `ALTER TABLE ... FORCE ROW LEVEL SECURITY` on every table.
- RLS policies use `current_setting('app.agent_id')` set per-transaction by the MCP server via `SET LOCAL`.
- Test RLS by attempting cross-agent reads in integration tests.
**Detection:** Query `SELECT * FROM pg_policies` and verify policies exist. Test with two agent contexts.
**Phase:** Phase 1 (DB setup). RLS is nearly impossible to retrofit correctly after data exists.

### Pitfall 3: Agent Container Escape via Mounted Volumes or Docker Socket

**What goes wrong:** The agent container, meant to be sandboxed, has a volume mount to the host filesystem or access to the Docker socket. An agent running untrusted code escapes the sandbox trivially.
**Why it happens:** During development, you mount the host project directory for convenience. Or you expose `/var/run/docker.sock` for Docker-in-Docker workflows. These get left in docker-compose.yml.
**Consequences:** Full host compromise. Agent can read host files, spawn privileged containers, access credentials.
**Prevention:**
- Never mount the Docker socket into the agent container. Period.
- Agent container volumes should be named volumes or tmpfs, never host bind mounts in production.
- Use Nono (or gVisor/kata) as a second isolation layer inside the container.
- docker-compose.yml should have `read_only: true` on the agent container's root filesystem.
- Add `security_opt: [no-new-privileges:true]` and drop all capabilities.
**Detection:** Audit docker-compose.yml for bind mounts and socket mounts. Run `docker inspect` and check Mounts.
**Phase:** Phase 2 (agent harness). Must be correct from the first agent run.

### Pitfall 4: Credential Leakage via Environment Variable Exposure

**What goes wrong:** API keys (OpenRouter, OpenAI, etc.) injected via environment variables are readable by any process in the container, logged by debugging tools, or exposed via `/proc/1/environ`. An agent running untrusted code can exfiltrate them.
**Why it happens:** Environment variables are the standard Docker secret mechanism, but they are not truly secret from processes inside the container.
**Consequences:** API key theft. Attacker uses your embedding API keys, runs up bills, accesses your accounts.
**Prevention:**
- Use Docker secrets (mounted as files in `/run/secrets/`) instead of env vars for sensitive credentials.
- The MCP server should hold API keys, not the agent container. Agent never needs direct API access -- it goes through MCP.
- If the agent container must have credentials, use a minimal sidecar or init container that fetches and injects them, then the secret source is not in the agent's env.
- Network policy: agent can only reach MCP server, not the internet directly. Even if keys leak, agent cannot exfiltrate.
**Detection:** Run `docker exec agent-container env` and verify no secrets are visible. Check docker-compose.yml for `environment:` blocks with API keys.
**Phase:** Phase 1 (docker-compose design). Credential architecture must be right from the start.

### Pitfall 5: pgvector Index Missing or Misconfigured, Search Becomes O(n)

**What goes wrong:** You skip creating an index (HNSW or IVFFlat) on the vector column, or create one with wrong parameters. With 10K+ rows, every similarity search does a full table scan. Response times go from 5ms to 5 seconds.
**Why it happens:** pgvector works without an index (brute-force scan). Small test datasets are fast, so you never notice until production data arrives.
**Consequences:** Unusable latency for semantic search. Agents timeout or users experience multi-second delays.
**Prevention:**
- Create an HNSW index immediately: `CREATE INDEX ON items USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)`.
- HNSW over IVFFlat -- HNSW does not require a separate training step and handles incremental inserts well.
- Set `hnsw.ef_search` at query time (default 40, increase for better recall at cost of latency).
- Benchmark with realistic data volume (1K, 10K, 100K rows) early.
**Detection:** `EXPLAIN ANALYZE` on a similarity query. If it shows "Seq Scan" instead of "Index Scan", index is missing or not being used.
**Phase:** Phase 1 (DB schema). Index should exist from day one.

## Moderate Pitfalls

### Pitfall 6: MCP Server as an Unauthenticated Open Proxy

**What goes wrong:** The MCP server exposes CRUD operations but has no authentication. Any container (or anything on the Docker network) can call it. If the agent container is compromised, the attacker gets full DB CRUD with no audit trail tied to identity.
**Prevention:**
- MCP server requires a per-agent token (even a simple shared secret per agent role).
- Token is passed in MCP request headers and logged with every operation.
- Docker network segmentation: only the agent container can reach MCP's port.
- Rate limiting on MCP endpoints to prevent data exfiltration at scale.
**Phase:** Phase 2 (MCP server implementation).

### Pitfall 7: Backup Strategy That Skips Vector Data or Breaks on Restore

**What goes wrong:** `pg_dump` works, but restoring into a fresh Postgres instance fails because pgvector extension is not pre-installed. Or backups exclude large binary data (TOAST tables where vectors live) due to size.
**Prevention:**
- Restore script must `CREATE EXTENSION IF NOT EXISTS vector` before restoring data.
- Test the full backup-restore cycle in CI: dump, spin up fresh container, restore, run a similarity query.
- Use `pg_dump --format=custom` (not plain SQL) for reliable large-data restores.
- Include the pgvector version in backup metadata.
**Phase:** Phase 3 (operations/backup tooling). But design for it in Phase 1 by scripting the restore path.

### Pitfall 8: Nono/Sandbox Tool Not Available on Target Platform

**What goes wrong:** Nono (or chosen sandbox tool) works on your Mac in dev but fails on Linux CI, ARM hosts, or cloud VMs due to missing kernel features or architecture incompatibility.
**Prevention:**
- Verify Nono supports your target platforms (Linux amd64 at minimum) before committing to it.
- Have a fallback isolation strategy (gVisor runsc, or at minimum seccomp + dropped capabilities).
- Test the agent container on Linux early, not just Docker Desktop on Mac.
**Phase:** Phase 2 (agent harness). Validate platform compatibility before building on top of it.

### Pitfall 9: Docker Network Allows Agent-to-DB Direct Connection

**What goes wrong:** Default docker-compose puts all services on one network. The agent container can bypass MCP and connect to Postgres directly, defeating the entire security model.
**Prevention:**
- Use two Docker networks: `frontend` (agent + MCP) and `backend` (MCP + DB).
- Agent is only on `frontend`. DB is only on `backend`. MCP bridges both.
- Verify with `docker exec agent-container pg_isready -h db -p 5432` -- it should fail.
**Phase:** Phase 1 (docker-compose design). Network topology is foundational.

### Pitfall 10: Embedding API Rate Limits and Failures Not Handled

**What goes wrong:** Bulk insert of 1000 records fires 1000 embedding API calls. Provider rate-limits you. Half the records get embeddings, half don't. No retry. Data is partially indexed.
**Prevention:**
- Batch embedding calls (most providers support batch endpoints).
- Implement retry with exponential backoff in the embedding layer.
- Never insert a record without its embedding -- make embedding generation transactional with the DB insert.
- For bulk operations, use a queue/batch processor, not inline API calls.
**Phase:** Phase 2 (MCP server / embedding layer).

## Minor Pitfalls

### Pitfall 11: Agent Skill Scripts Assume Host Environment

**What goes wrong:** Agent skill scripts use `npx`, `curl`, or other tools not installed in the agent container. Works in dev (host-mounted), fails in production.
**Prevention:** Dockerfile for agent container must install all dependencies. Test skills inside the container, not on the host.
**Phase:** Phase 2 (agent container).

### Pitfall 12: Audit Log Table Grows Unbounded

**What goes wrong:** Every write operation is logged. After months, the audit table is larger than the data table. Queries slow down, disk fills.
**Prevention:** Partition audit logs by month. Add a retention policy (delete or archive logs older than N months). Use `pg_partman` or manual partitioning.
**Phase:** Phase 3 (operations).

### Pitfall 13: Cosine Similarity Threshold Chosen Arbitrarily

**What goes wrong:** You hardcode a similarity threshold of 0.8 for "relevant" results. Different embedding models produce different similarity distributions. A threshold tuned for OpenAI ada-002 returns zero results with a different provider.
**Prevention:** Make threshold configurable per-provider. Log similarity score distributions early and tune empirically. Consider returning top-K results rather than threshold-based filtering.
**Phase:** Phase 2 (MCP search implementation).

### Pitfall 14: MCP Transport Choice -- stdio vs HTTP

**What goes wrong:** Agent expects HTTP transport, MCP server provides stdio (or vice versa). Connection fails silently or with cryptic errors.
**Prevention:** For Docker containers (separate processes), use HTTP-based transport (SSE or Streamable HTTP). stdio is only for same-process MCP. Decide transport in Phase 1 and document it.
**Phase:** Phase 2 (MCP server).

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| DB schema design | Dimension mismatch (#1), missing index (#5), RLS bypass (#2) | Explicit vector dimensions, HNSW index, FORCE RLS, non-superuser MCP role |
| Docker networking | Agent-to-DB bypass (#9), credential leakage (#4) | Two-network topology, secrets as files not env vars |
| Agent harness | Container escape (#3), sandbox platform compat (#8) | No host mounts, no Docker socket, verify Nono on Linux |
| MCP server | Unauthenticated access (#6), embedding failures (#10), transport (#14) | Per-agent tokens, batch + retry for embeddings, HTTP transport for containers |
| Operations | Backup restore failures (#7), audit log growth (#12) | Test full restore cycle, partition audit logs |
| Embedding layer | Dimension mismatch on provider switch (#1), threshold drift (#13) | Store model metadata, configurable thresholds |

## Sources

- PostgreSQL RLS documentation: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- pgvector documentation on indexing: https://github.com/pgvector/pgvector#indexing
- Docker Compose networking documentation: https://docs.docker.com/reference/compose-file/services/
- Training data knowledge of Docker security, MCP protocol (MEDIUM confidence)
- Prior art from PROJECT.md Session 001 validation on Supabase
