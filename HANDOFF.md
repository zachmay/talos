# Session Handoff — 2026-04-22

Productization pass: ten extension phases shipped earlier in the day, then a
cleanup sweep to get to a publishable state. What the next session needs to
know.

## State of the repo

- **Monorepo.** pnpm workspaces, layout is `packages/mcp/` +
  `packages/vscode-extension/`. Root `package.json` has convenience scripts
  (`pnpm typecheck`, `pnpm ext:build`, `pnpm mcp:test`, `pnpm docker:up`, etc.).
- **Docker stack rebuilds clean.** `./talos health` reports 9/9 passing.
  Multi-stage Dockerfile uses `pnpm deploy` to produce a standalone runtime
  image from the workspace.
- **Security baseline.** Host ports all bound to `127.0.0.1`. No hardcoded
  bearer tokens in import scripts. Startup warnings when insecure flags are
  active. SECURITY.md §6 + §7 document the remaining intentional postures.
- **Legal.** LICENSE is proprietary / all rights reserved. `package.json`
  license field is `"UNLICENSED"` to match.

## What's been verified

- `pnpm install` → clean
- `pnpm typecheck` → clean (both packages)
- `pnpm ext:build` → clean (extension + webview bundles)
- `docker compose down && up -d --build` → all four services healthy
- MCP `/health` responds
- Startup warnings fire in MCP logs when dev overlay is active
- `import-audit/sync-import.py` loads its bearer from `secrets/agent_keys.json`

## What still needs manual verification

**Walk [MANUAL_TEST.md](MANUAL_TEST.md) end-to-end.** Items 1–5 are
already verified above. Items 6 onward (extension dev host, tree browsing,
markdown editor + autosave, wikilinks, autocomplete, ETag conflict modal,
new-note + collision, URI handler, etc.) need hands-on confirmation in the
dev host that I couldn't do from this session.

Any FAIL on the checklist is a handoff blocker.

## Known debt

### Test suite (tracked in `.planning/ROADMAP.md` backlog)

- `packages/mcp/tests/tools/insert.test.ts` and `update.test.ts` have 11 stale
  tests. They predate title/type promotion, `if_match` enforcement, and
  collision checks. `pnpm mcp:test` reports 57 passing, 11 failing.
- `packages/vscode-extension` ships zero tests.
- No CI. Typecheck/build/tests are manual-only.

### Feature backlog

All captured in `.planning/ROADMAP.md` under the **Backlog** section:

- VS Code extension: mime viewers (Phase 6), drag-to-reparent, capture
  selection, SSE live refresh, graph view.
- Operator-superset views: import trigger, audit log viewer, agent
  inspection, MCP health controls.
- Vault/import: generalized Obsidian importer (YAML config), `./talos sync`
  CLI, CLAUDE.md workflow docs.
- Editor niceties: note type picker, cursor-aware bracket hiding, Milkdown
  custom nodes (Approach B for wikilinks), discriminated-union error data.

### Open security questions (unchanged from SECURITY.md §5)

Items 2–7 remain `[BLOCKING]` for production deployment: seccomp verification,
gVisor availability, Anthropic embedding stub, agent egress restriction, MCP
TLS, DB `pg_hba.conf` audit. Item 1 (DB port exposure) is `[RESOLVED]` as of
this session.

## How to resume

1. `pnpm install` if dependencies have drifted
2. `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d`
3. Walk [MANUAL_TEST.md](MANUAL_TEST.md)
4. Address any failures found
5. When all manual tests pass, promote to handoff-complete

## Recent git log

See `git log` for commit-level detail. Key commits from this session:

- `4ad2e63` security cleanup pass
- `dec0209` pnpm monorepo conversion
- `577784d` README
- `0a0166b` pre-handoff cleanup (LICENSE, launch.json fix, roadmap reconcile)
