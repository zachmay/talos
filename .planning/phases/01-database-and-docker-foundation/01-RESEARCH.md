# Phase 1: Database and Docker Foundation - Research

**Researched:** 2026-03-27
**Domain:** PostgreSQL + pgvector, Docker Compose networking, Docker secrets, Row Level Security
**Confidence:** HIGH (core stack), MEDIUM (some HNSW tuning specifics)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Schema Design**
- Two-table model: `entries` (content/metadata) + `chunks` (windowed embeddings)
  - `entries`: id (UUIDv4), content (TEXT, full document), metadata (JSONB), agent_id (TEXT), created_at, updated_at
  - `chunks`: id (UUIDv4), entry_id (FK → entries), chunk_idx (INT), chunk_text (TEXT), embedding (VECTOR), agent_id (TEXT, denormalized for RLS)
- Small documents still get chunked (single chunk) — uniform model, no special cases
- Freeform metadata JSONB on entries — no enforced keys, GIN-indexed for any-key filtering
- Agent identity via session variable: MCP sets `app.agent_id` before each query, RLS policies check `current_setting('app.agent_id')` — applied to BOTH tables
- Path array in metadata for filesystem-like hierarchy: `path: ['tasks', 'home', 'mow the yard.md']`
  - Path is optional — docs without it are flat
  - Supported: exact path match, prefix/subtree listing, depth-limited listing (direct children only)
- Cosine similarity only for distance metric
- Containment (`@>`) for general metadata filtering + array operators for path hierarchy queries
- Semantic search function searches chunks, joins to entries to return full content
- Semantic search supports path-scoped queries
- Table names: `entries` + `chunks`, DB function: `match_entries`
- HNSW index on chunks.embedding, GIN index on entries.metadata

**Init & Bootstrap**
- Raw SQL init scripts in `docker-entrypoint-initdb.d/` directory, numbered for execution order
- Optional dev seed script (not auto-run)
- Base image: `pgvector/pgvector:pg17`
- Vector dimensions set at init time via `VECTOR_DIMENSIONS` env var (default 1536)

**Credential & Secrets Flow**
- Docker secrets only — mounted at `/run/secrets/`, nothing in env vars or image layers
- Bash `setup.sh` generates all secrets (DB passwords + embedding API key placeholders for Phase 2)
- Idempotent: skips existing secret files on re-run
- `secrets/` directory gitignored, `secrets.example/` with placeholder files committed
- Two DB roles: `postgres` (superuser, init/admin only) and `mcp_service` (limited DML + EXECUTE, RLS enforced)

**Container & Network Layout**
- Two named networks: `backend` (MCP<->DB) and `frontend` (agent<->MCP)
- DB only on backend, MCP on both, agent only on frontend
- DB port 5432 exposed to host for dev only (via compose profiles)
- Named Docker volume (`pgdata`) for Postgres data persistence
- `pg_isready` health check on DB; MCP depends on `service_healthy`
- Stub MCP and agent services (alpine + sleep) included in Phase 1 for network topology testing
- Service-based directory structure: `db/`, `mcp/`, `agent/`, `scripts/`
- Docker Compose profiles: dev (default, exposes DB port) and prod (fully internal)
- Short service names: `db`, `mcp`, `agent`

### Claude's Discretion
- Exact SQL for init scripts (extension setup, schema, functions, RLS policies, triggers)
- HNSW index parameters (ef_construction, m)
- Health check intervals and retry counts
- setup.sh password generation method (openssl rand or similar)
- Dev seed script content and structure

### Deferred Ideas (OUT OF SCOPE)
- Dimension change/reindex script — utility for when embedding provider changes (backlog)
- MCP tool naming conventions — Phase 2
- Embedding provider API key usage — Phase 2
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DB-01 | Postgres Docker image with pgvector extension pre-installed and enabled | `pgvector/pgvector:pg17` image; `CREATE EXTENSION IF NOT EXISTS vector` in init script |
| DB-02 | Vector column dimensions configurable via environment variable (not hardcoded) | `VECTOR_DIMENSIONS` env var read inside init SQL via `current_setting` or shell substitution |
| DB-03 | HNSW index on vector columns for fast approximate nearest-neighbor search | `CREATE INDEX USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64)` |
| DB-04 | GIN index on JSONB metadata columns for fast filtering | `CREATE INDEX USING gin (metadata)` on entries table |
| DB-05 | RLS enabled with `FORCE ROW LEVEL SECURITY` on all data tables | `ALTER TABLE ... ENABLE ROW LEVEL SECURITY; ALTER TABLE ... FORCE ROW LEVEL SECURITY;` |
| DB-06 | Non-superuser role for MCP server connections | `CREATE ROLE mcp_service LOGIN PASSWORD ...; GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE ON ...` |
| DB-07 | Per-agent RLS policies — each agent identity scoped to its own rows only | `USING (agent_id = current_setting('app.agent_id'))` policy on both tables |
| DB-08 | Semantic search function (cosine similarity with threshold, count, metadata filter, agent-scoped) | PL/pgSQL function using `<=>` operator; joins chunks to entries; filters by agent_id via session var |
| DB-09 | Auto-updated timestamp trigger on modified rows | `CREATE FUNCTION set_updated_at()` + `CREATE TRIGGER` for `BEFORE UPDATE` on entries |
| INF-01 | docker-compose for one-command local startup | `docker compose up` with health checks and depends_on |
| INF-02 | Dual-network topology — agent↔MCP and MCP↔DB, agent cannot reach DB | `networks: frontend/backend` with DB on backend only, agent on frontend only |
| INF-03 | Credential injection via Docker secrets or env vars (no baked-in secrets) | `POSTGRES_PASSWORD_FILE` convention; secrets mounted at `/run/secrets/` |
</phase_requirements>

---

## Summary

Phase 1 establishes a self-hosted Postgres+pgvector database inside a hardened Docker Compose topology. All architectural decisions are locked via CONTEXT.md — research here fills in exact syntax, verified parameter values, and the specific pitfalls that cause Phase 1 re-work.

The core stack is mature and stable: pgvector v0.8.x with its `pgvector/pgvector:pg17` Docker image is the industry standard for self-hosted vector search. The RLS pattern using `current_setting('app.agent_id')` is well-supported in Postgres 17 and is the correct approach for per-agent row isolation without separate DB roles per agent. Docker Compose secrets via `/run/secrets/` with `POSTGRES_PASSWORD_FILE` is the official pattern for credential injection.

The three areas that require special care are: (1) ensuring the init SQL scripts are executed in the right order and that `CREATE EXTENSION` happens before schema creation, (2) the `set_config` call for `app.agent_id` must use `is_local = true` (transaction-scoped) so the value resets between requests, and (3) HNSW index creation must happen after data is loaded or expect slow rebuilds — empty-table index creation is fine for fresh init.

**Primary recommendation:** Use numbered SQL files in `docker-entrypoint-initdb.d/` (01-extensions, 02-roles, 03-schema, 04-indexes, 05-functions, 06-rls), generate secrets with `openssl rand -base64 32`, and use `POSTGRES_PASSWORD_FILE` to inject them.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pgvector/pgvector | 0.8.2 | Postgres with vector extension | Official image, supports pg17, HNSW in 0.5+ |
| PostgreSQL | 17 | Relational database | LTS, current stable, best RLS support |
| Docker Compose | v2 (Compose spec) | Container orchestration | Secrets, profiles, health checks all in v2 |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pgvector extension | 0.8.x (bundled in image) | HNSW + cosine distance | Always — pre-installed in base image |
| Alpine Linux | latest | Stub service base | Lightweight placeholder for mcp/agent in Phase 1 |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| pgvector/pgvector:pg17 | postgres:17 + manual install | Manual install works but requires more init script complexity |
| Docker secrets | env vars | Env vars appear in `docker inspect`, image history — rejected for security |
| HNSW index | IVFFlat | IVFFlat requires training data to set lists; HNSW is better for dynamic inserts |

**Installation:** No local installation — everything runs in Docker.

---

## Architecture Patterns

### Recommended Project Structure

```
talos/
├── db/
│   └── init/                      # Numbered SQL init scripts
│       ├── 01-extensions.sql
│       ├── 02-roles.sql
│       ├── 03-schema.sql
│       ├── 04-indexes.sql
│       ├── 05-functions.sql
│       └── 06-rls.sql
├── mcp/                           # Stub in Phase 1 (alpine + sleep)
│   └── Dockerfile
├── agent/                         # Stub in Phase 1 (alpine + sleep)
│   └── Dockerfile
├── scripts/
│   └── setup.sh                   # Secret generation script
├── secrets/                       # gitignored, created by setup.sh
├── secrets.example/               # Committed placeholder files
│   ├── db_password.txt
│   └── mcp_password.txt
└── docker-compose.yml
```

### Pattern 1: Numbered Init Scripts

**What:** SQL files in `docker-entrypoint-initdb.d/` run in lexicographic (alphabetical) order on first container start. Named with numeric prefixes to enforce order.

**When to use:** Always — the Postgres official image and pgvector image both support this pattern.

**Example:**
```sql
-- db/init/01-extensions.sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- db/init/03-schema.sql
CREATE TABLE entries (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content     TEXT NOT NULL,
    metadata    JSONB NOT NULL DEFAULT '{}',
    agent_id    TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE chunks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id    UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    chunk_idx   INT NOT NULL,
    chunk_text  TEXT NOT NULL,
    embedding   VECTOR(1536),     -- dimension substituted at init time
    agent_id    TEXT NOT NULL     -- denormalized for RLS performance
);
```

**Dimension substitution:** The `VECTOR_DIMENSIONS` env var cannot be read directly in SQL. Two approaches:
1. Use a shell script wrapper (`*.sh` in initdb.d runs as bash, can use `envsubst`) — HIGH confidence
2. Set default via `ALTER SYSTEM` after init — more complex

Recommended: Place a `00-configure.sh` that runs `envsubst` on the schema template and writes the SQL file, then subsequent numbered `.sql` files run.

### Pattern 2: RLS with Session Variables

**What:** Postgres allows custom GUC parameters in the `app.*` namespace. MCP sets `app.agent_id` per transaction; RLS policies read it.

**When to use:** Per-agent isolation without a role per agent. One DB role (`mcp_service`) serves all agents.

**Example:**
```sql
-- db/init/06-rls.sql
ALTER TABLE entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE entries FORCE ROW LEVEL SECURITY;
ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks FORCE ROW LEVEL SECURITY;

-- Policies use current_setting with missing_ok=true to avoid errors if not set
CREATE POLICY entries_agent_isolation ON entries
    USING (agent_id = current_setting('app.agent_id', true));

CREATE POLICY chunks_agent_isolation ON chunks
    USING (agent_id = current_setting('app.agent_id', true));
```

**MCP sets the variable per transaction (is_local=true resets after commit):**
```sql
-- Called by MCP before every query
SELECT set_config('app.agent_id', $1, true);
```

### Pattern 3: Docker Secrets with Postgres

**What:** Docker Compose secrets are mounted as files. Postgres official images (and pgvector image) support `_FILE` suffixed env vars that read the credential from the file path.

**When to use:** Always for credential injection.

**Example (docker-compose.yml):**
```yaml
services:
  db:
    image: pgvector/pgvector:pg17
    environment:
      POSTGRES_DB: talos
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    secrets:
      - db_password
    networks:
      - backend
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./db/init:/docker-entrypoint-initdb.d
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d talos"]
      interval: 5s
      timeout: 5s
      retries: 10
      start_period: 10s

  mcp:
    image: alpine
    command: sleep infinity
    networks:
      - backend
      - frontend
    depends_on:
      db:
        condition: service_healthy
    secrets:
      - mcp_password

  agent:
    image: alpine
    command: sleep infinity
    networks:
      - frontend

networks:
  backend:
  frontend:

volumes:
  pgdata:

secrets:
  db_password:
    file: ./secrets/db_password.txt
  mcp_password:
    file: ./secrets/mcp_password.txt
```

### Pattern 4: Dual-Network Isolation

**What:** Services are isolated by only being connected to networks they need. No firewall rules needed — Docker network namespaces provide hard isolation.

**Isolation guarantee:** Agent container has `frontend` network only. DB container has `backend` network only. They share no network — connection from agent to db will result in DNS resolution failure or connection refused.

**Test approach:**
```bash
# Verify isolation: should fail
docker compose exec agent ping db  # DNS failure expected
# Verify connectivity: should succeed
docker compose exec mcp ping db    # Should resolve
```

### Pattern 5: Semantic Search Function

**What:** PL/pgSQL function that takes a query embedding + agent_id (via session var) + optional metadata filter, searches chunks by cosine distance, joins to entries, returns full entry content.

**Example:**
```sql
-- db/init/05-functions.sql
CREATE OR REPLACE FUNCTION match_entries(
    query_embedding   VECTOR,
    match_threshold   FLOAT    DEFAULT 0.7,
    match_count       INT      DEFAULT 10,
    filter_metadata   JSONB    DEFAULT NULL
)
RETURNS TABLE (
    id          UUID,
    content     TEXT,
    metadata    JSONB,
    agent_id    TEXT,
    similarity  FLOAT
)
LANGUAGE plpgsql
SECURITY DEFINER   -- runs with owner's privileges, RLS still applies via session var
AS $$
BEGIN
    RETURN QUERY
    SELECT DISTINCT ON (e.id)
        e.id,
        e.content,
        e.metadata,
        e.agent_id,
        1 - (c.embedding <=> query_embedding) AS similarity
    FROM chunks c
    JOIN entries e ON c.entry_id = e.id
    WHERE 1 - (c.embedding <=> query_embedding) >= match_threshold
      AND (filter_metadata IS NULL OR e.metadata @> filter_metadata)
    ORDER BY e.id, c.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

GRANT EXECUTE ON FUNCTION match_entries TO mcp_service;
```

**Note on SECURITY DEFINER:** Use with care — it bypasses RLS by default unless the function explicitly filters by `current_setting('app.agent_id', true)`. Either use `SECURITY INVOKER` (default) so RLS applies naturally to the mcp_service role, or add explicit `agent_id = current_setting('app.agent_id', true)` filter in the WHERE clause.

**Recommended:** `SECURITY INVOKER` (default) so RLS on both tables handles isolation automatically.

### Pattern 6: Updated-At Trigger

```sql
-- db/init/05-functions.sql (alongside match_entries)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER entries_updated_at
    BEFORE UPDATE ON entries
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

### Anti-Patterns to Avoid

- **Init scripts with no ordering prefix:** Files execute lexicographically; `schema.sql` runs before `extensions.sql` alphabetically, causing `vector` type not found errors.
- **Using `is_local = false` for app.agent_id:** Session-scoped means one query's agent bleeds into the next if the connection is reused. Always use `is_local = true` (transaction scope).
- **POSTGRES_PASSWORD in env (not _FILE):** Appears in `docker inspect` output and container env dumps. Use `POSTGRES_PASSWORD_FILE` exclusively.
- **Building secrets into the image via COPY:** Any `COPY secrets/ .` in a Dockerfile bakes credentials into the image layer permanently.
- **Creating the HNSW index before the extension loads:** `CREATE INDEX USING hnsw` requires the `vector` extension. Ensure 01-extensions.sql runs first.
- **No `start_period` in health check:** Postgres takes 5-10 seconds to initialize on first run (init scripts execute). Without `start_period`, health checks fail immediately and the container is marked unhealthy before initialization completes.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cosine nearest-neighbor search | Custom distance calculation in SQL | pgvector `<=>` operator + HNSW index | HNSW uses approximate graph search; hand-rolled is O(n) full scan |
| Credential rotation/injection | Custom secret env var parsing | `POSTGRES_PASSWORD_FILE` convention | Official convention, supported by pgvector image |
| Per-agent row filtering | Application-layer WHERE clauses in every query | Postgres RLS | RLS cannot be bypassed by application bugs; app-layer filters can be forgotten |
| Container dependency ordering | Sleep loops in entrypoints | `depends_on: condition: service_healthy` | healthcheck + depends_on is the canonical pattern; sleep loops are fragile |
| Network isolation | iptables rules or firewalls | Docker named networks | Network namespaces provide kernel-level isolation; no configuration drift |

**Key insight:** Postgres RLS is the right place for security enforcement — it's enforced at the database engine level regardless of what code runs above it. Application-layer filters are defense-in-depth, not the primary control.

---

## Common Pitfalls

### Pitfall 1: VECTOR Dimension Mismatch at Insert Time

**What goes wrong:** Schema defines `VECTOR(1536)` but MCP sends 3072-dimension embeddings (e.g., OpenAI text-embedding-3-large). Insert fails with dimension mismatch error.

**Why it happens:** Dimension is baked into the column type at CREATE TABLE time. The `VECTOR_DIMENSIONS` env var must be correctly set before first `docker compose up`.

**How to avoid:** Make dimension substitution explicit in init script. Document the env var prominently in README. Do not hardcode 1536 anywhere in SQL — always reference the variable.

**Warning signs:** `ERROR: expected N dimensions, not M` on INSERT.

### Pitfall 2: RLS Bypassed by Table Owner

**What goes wrong:** The `postgres` superuser or table owner can read all rows, ignoring RLS policies.

**Why it happens:** By default, table owners bypass RLS. `ENABLE ROW LEVEL SECURITY` alone is insufficient.

**How to avoid:** Use `FORCE ROW LEVEL SECURITY` on every table. This makes even the owner subject to policies.

**Warning signs:** Direct `psql` as `postgres` user returns all rows for all agents.

### Pitfall 3: Init Scripts Don't Re-Run on Config Change

**What goes wrong:** Developer changes an init script and does `docker compose up` — nothing changes. Old schema persists.

**Why it happens:** `docker-entrypoint-initdb.d/` scripts only run when the data directory is empty (first initialization). If `pgdata` volume exists, scripts are skipped.

**How to avoid:** To re-initialize: `docker compose down -v` (removes volumes) then `docker compose up`. Document this prominently. For schema changes in development, use separate migration scripts or `docker compose down -v`.

**Warning signs:** Schema changes have no effect after re-running `docker compose up`.

### Pitfall 4: Secrets Directory Not Gitignored Before First Commit

**What goes wrong:** Developer runs `setup.sh`, then `git add .`, accidentally commits real credentials.

**Why it happens:** `secrets/` directory doesn't exist until `setup.sh` runs; easy to miss in `.gitignore` setup.

**How to avoid:** Add `secrets/` to `.gitignore` as the very first commit, before `setup.sh` is written. Verify with `git check-ignore -v secrets/db_password.txt`.

**Warning signs:** `git status` shows `secrets/` as untracked after running `setup.sh`.

### Pitfall 5: Missing `missing_ok` in `current_setting()`

**What goes wrong:** If a connection runs a query without first setting `app.agent_id`, `current_setting('app.agent_id')` throws `ERROR: unrecognized configuration parameter "app.agent_id"`.

**Why it happens:** Custom GUC parameters don't exist until set.

**How to avoid:** Always use `current_setting('app.agent_id', true)` — the second argument (`missing_ok`) returns NULL instead of throwing. Policy becomes `USING (agent_id = current_setting('app.agent_id', true))`. A NULL match returns no rows (correct behavior — unset agent ID sees nothing).

**Warning signs:** `ERROR: unrecognized configuration parameter` in DB logs.

### Pitfall 6: Health Check Fails During Init Script Execution

**What goes wrong:** `pg_isready` returns true as soon as Postgres accepts connections, but init scripts haven't finished yet. MCP stub starts, tries to connect, but tables don't exist.

**Why it happens:** `pg_isready` checks TCP connectivity, not schema readiness. Long init scripts create a window where the service is "healthy" but not ready.

**How to avoid:** Add `start_period: 15s` to the health check. For the stub services in Phase 1, this is sufficient. In Phase 2, MCP should handle reconnect-with-retry.

---

## Code Examples

### setup.sh (Secret Generation)

```bash
#!/usr/bin/env bash
# Source: standard Docker secrets pattern
set -euo pipefail

SECRETS_DIR="$(dirname "$0")/../secrets"
mkdir -p "$SECRETS_DIR"

generate_secret() {
    local file="$1"
    if [[ -f "$file" ]]; then
        echo "  Skipping $file (already exists)"
    else
        openssl rand -base64 32 | tr -d '\n' > "$file"
        chmod 600 "$file"
        echo "  Generated $file"
    fi
}

echo "Generating secrets..."
generate_secret "$SECRETS_DIR/db_password.txt"
generate_secret "$SECRETS_DIR/mcp_password.txt"

# Placeholder for Phase 2 embedding API key
if [[ -f "$SECRETS_DIR/embedding_api_key.txt" ]]; then
    echo "  Skipping embedding_api_key.txt (already exists)"
else
    echo "REPLACE_WITH_YOUR_EMBEDDING_API_KEY" > "$SECRETS_DIR/embedding_api_key.txt"
    chmod 600 "$SECRETS_DIR/embedding_api_key.txt"
    echo "  Created embedding_api_key.txt placeholder — update before Phase 2"
fi

echo "Done. Run 'docker compose up' to start."
```

### Docker Compose Profile Pattern (dev vs prod)

```yaml
# Exposes DB port only in dev profile
services:
  db:
    image: pgvector/pgvector:pg17
    ports:
      - "5432:5432"    # Remove this block in prod, or use profiles
    profiles:
      - dev            # Only starts with --profile dev
    # ... rest of config

  db-prod:             # Alternative: separate service per profile
```

**Simpler approach** (single service, profile-conditional port):
```yaml
services:
  db:
    image: pgvector/pgvector:pg17
    # ports block only present in dev override file
```

Use `docker-compose.override.yml` for dev-specific port exposure — this file is auto-merged by Docker Compose in dev and excluded in prod.

### mcp_service Role Setup

```sql
-- db/init/02-roles.sql
-- Read password from secret file (injected via Docker secrets into initdb environment)
CREATE ROLE mcp_service WITH LOGIN PASSWORD 'placeholder';
-- Note: actual password set via PGPASSWORD or connection string from secret in Phase 2

-- Grant schema usage
GRANT USAGE ON SCHEMA public TO mcp_service;

-- Grant DML on data tables
GRANT SELECT, INSERT, UPDATE, DELETE ON entries TO mcp_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON chunks TO mcp_service;

-- Grant execute on search function
GRANT EXECUTE ON FUNCTION match_entries TO mcp_service;
```

**Note on mcp_service password during init:** The init script runs as the `postgres` superuser. To use Docker secrets for the `mcp_service` password, the `02-roles.sql` can read from the secret file using a shell script wrapper (`.sh` extension in initdb.d runs as bash):

```bash
#!/usr/bin/env bash
# db/init/02-roles.sh
set -e
MCP_PASSWORD=$(cat /run/secrets/mcp_password)
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE ROLE mcp_service WITH LOGIN PASSWORD '$MCP_PASSWORD';
    GRANT USAGE ON SCHEMA public TO mcp_service;
    GRANT SELECT, INSERT, UPDATE, DELETE ON entries TO mcp_service;
    GRANT SELECT, INSERT, UPDATE, DELETE ON chunks TO mcp_service;
EOSQL
```

### Cosine Similarity Query Pattern

```sql
-- Source: pgvector README - cosine distance is <=> operator
-- 1 - distance = similarity
SELECT
    e.id,
    e.content,
    e.metadata,
    1 - (c.embedding <=> $1::vector) AS similarity
FROM chunks c
JOIN entries e ON c.entry_id = e.id
WHERE 1 - (c.embedding <=> $1::vector) >= 0.7
ORDER BY c.embedding <=> $1::vector
LIMIT 10;
```

### HNSW Index Creation

```sql
-- Source: pgvector README - cosine_ops for cosine distance
-- Defaults: m=16, ef_construction=64 are appropriate for moderate datasets
CREATE INDEX ON chunks USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
```

### Network Isolation Test Script

```bash
#!/usr/bin/env bash
# scripts/test-network.sh - verify topology after docker compose up
set -e

echo "Testing network isolation..."

# Agent should NOT reach DB
if docker compose exec agent ping -c 1 db > /dev/null 2>&1; then
    echo "FAIL: agent can reach db (isolation broken)"
    exit 1
else
    echo "PASS: agent cannot reach db"
fi

# MCP should reach DB
if docker compose exec mcp ping -c 1 db > /dev/null 2>&1; then
    echo "PASS: mcp can reach db"
else
    echo "FAIL: mcp cannot reach db"
    exit 1
fi

# Agent should reach MCP
if docker compose exec agent ping -c 1 mcp > /dev/null 2>&1; then
    echo "PASS: agent can reach mcp"
else
    echo "FAIL: agent cannot reach mcp"
    exit 1
fi

echo "Network topology verified."
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| IVFFlat index | HNSW index | pgvector 0.5.0 (2023) | Better recall, no training data required |
| `<->` L2 distance | `<=>` cosine distance | pgvector 0.1+ | Must use correct operator for chosen distance metric |
| Separate roles per agent | Single role + RLS session vars | Always best practice | Eliminates role explosion with many agents |
| `POSTGRES_PASSWORD` env | `POSTGRES_PASSWORD_FILE` | Docker secrets v1 | Secrets no longer appear in inspect output |
| `docker-compose` v1 CLI | `docker compose` v2 CLI | Docker Desktop 3.4+ | `compose` is now a Docker plugin, not separate binary |

**Deprecated/outdated:**
- IVFFlat: Still works but HNSW is preferred for dynamic workloads (no need to know data size upfront)
- `docker-compose` (v1, Python): Replaced by `docker compose` (v2, Go plugin). Use `docker compose` in all scripts.

---

## Open Questions

1. **VECTOR_DIMENSIONS substitution in SQL init scripts**
   - What we know: `.sh` files in `docker-entrypoint-initdb.d/` run as bash and can use env vars; `.sql` files run as psql and cannot directly read shell env vars
   - What's unclear: Whether the pgvector image exposes `VECTOR_DIMENSIONS` to the init shell environment natively or if setup.sh must write the SQL template
   - Recommendation: Use a `00-configure.sh` init script that reads `VECTOR_DIMENSIONS` from environment and writes the schema SQL with the dimension substituted using `sed` or `envsubst`, before the numbered `.sql` files run

2. **mcp_service password injection during DB init**
   - What we know: Docker secrets are available at `/run/secrets/` inside the container during init; `.sh` initdb scripts can read them
   - What's unclear: Whether `POSTGRES_PASSWORD_FILE` convention works for non-superuser role passwords (it only handles the `POSTGRES_PASSWORD` for the superuser)
   - Recommendation: Use a `02-roles.sh` (bash) instead of `02-roles.sql` to read the secret file and pass it to `CREATE ROLE ... PASSWORD '...'`

3. **RLS behavior with SECURITY DEFINER on match_entries**
   - What we know: `SECURITY DEFINER` functions run as the function owner (postgres superuser), which bypasses RLS by default; `SECURITY INVOKER` runs as the caller (mcp_service), letting RLS apply
   - What's unclear: Whether explicit `agent_id = current_setting(...)` filter in the function WHERE clause is redundant if RLS is also active
   - Recommendation: Use `SECURITY INVOKER` (default) — RLS on chunks and entries handles isolation automatically; no need for SECURITY DEFINER complexity

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | bash + psql (shell scripts; no application test framework in Phase 1) |
| Config file | none — scripts in `scripts/` directory |
| Quick run command | `bash scripts/test-network.sh` |
| Full suite command | `bash scripts/test-all.sh` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DB-01 | pgvector extension enabled | smoke | `docker compose exec db psql -U postgres -d talos -c "SELECT * FROM pg_extension WHERE extname='vector';"` | Wave 0 |
| DB-02 | Dimension configurable via env | smoke | `docker compose exec db psql -U postgres -d talos -c "\d chunks"` — inspect vector column size | Wave 0 |
| DB-03 | HNSW index exists | smoke | `docker compose exec db psql -U postgres -d talos -c "SELECT indexname FROM pg_indexes WHERE indexname LIKE '%chunk%';"` | Wave 0 |
| DB-04 | GIN index on metadata | smoke | `docker compose exec db psql -U postgres -d talos -c "SELECT indexname FROM pg_indexes WHERE tablename='entries';"` | Wave 0 |
| DB-05 | RLS enabled + FORCE | smoke | `docker compose exec db psql -U postgres -d talos -c "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='entries';"` | Wave 0 |
| DB-06 | mcp_service role exists | smoke | `docker compose exec db psql -U postgres -d talos -c "\du mcp_service"` | Wave 0 |
| DB-07 | Agent isolation via RLS | integration | `docker compose exec db psql -U mcp_service -d talos -c "SELECT set_config('app.agent_id','agent-A',true); INSERT INTO entries ...; SELECT set_config('app.agent_id','agent-B',true); SELECT count(*) FROM entries;"` — count must be 0 | Wave 0 |
| DB-08 | match_entries function works | integration | psql call to match_entries with test embedding — returns rows for correct agent only | Wave 0 |
| DB-09 | updated_at auto-updates | unit | INSERT then UPDATE an entry, verify updated_at changed | Wave 0 |
| INF-01 | docker compose up succeeds | smoke | `docker compose up -d && docker compose ps` — all services healthy | Wave 0 |
| INF-02 | Network isolation verified | integration | `bash scripts/test-network.sh` | Wave 0 |
| INF-03 | No secrets in env/inspect | integration | `docker inspect talos-db-1 \| grep -i password` — must return empty | Wave 0 |

### Sampling Rate

- **Per task commit:** `docker compose ps` — verify containers healthy
- **Per wave merge:** `bash scripts/test-all.sh` — full smoke + integration suite
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `scripts/test-network.sh` — covers INF-02: network isolation checks
- [ ] `scripts/test-all.sh` — covers DB-01 through DB-09, INF-01 through INF-03
- [ ] `scripts/test-rls.sh` — covers DB-05, DB-07: agent isolation verification
- [ ] `scripts/setup.sh` — secret generation (needed before any docker compose up)

---

## Sources

### Primary (HIGH confidence)

- pgvector GitHub README (fetched 2026-03-27) — HNSW parameters, cosine operator, version 0.8.2
- PostgreSQL 17 docs (ddl-rowsecurity) — RLS FORCE, policy syntax, current_setting usage
- PostgreSQL 17 docs (functions-admin) — set_config(), current_setting() signatures and is_local behavior
- Docker Compose networking docs (fetched 2026-03-27) — multi-network, service isolation pattern
- Docker Compose secrets docs (fetched 2026-03-27) — /run/secrets/ mount, POSTGRES_PASSWORD_FILE convention

### Secondary (MEDIUM confidence)

- docker-entrypoint-initdb.d behavior: well-documented by multiple sources; .sh and .sql both supported
- pgvector/pgvector:pg17 image tag: follows consistent naming pattern (pgvector/pgvector:pg{N}); pg13-pg17 all listed in pgvector repo

### Tertiary (LOW confidence)

- HNSW parameter recommendations for 1536-dimension vectors: defaults (m=16, ef_construction=64) are known-good starting points; tuning for recall/speed tradeoff requires benchmarking with actual data

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — pgvector v0.8.2 on pg17 is current, confirmed via official repo
- Architecture: HIGH — Docker Compose secrets/networking are stable, officially documented patterns
- Pitfalls: HIGH — RLS bypass via table owner, init script ordering, secret exposure are known PostgreSQL/Docker issues with documented solutions
- HNSW tuning: MEDIUM — defaults are safe; optimal params require load testing with real data

**Research date:** 2026-03-27
**Valid until:** 2026-09-27 (stable stack; pgvector releases are infrequent for breaking changes)
