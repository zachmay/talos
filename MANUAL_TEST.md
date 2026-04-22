# Manual Test Checklist

Walk through this to verify a working deployment end-to-end. Assumes:

- You've run `./talos setup` at some point and `secrets/` is populated.
- `pnpm install` has run at the workspace root.
- `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d` is running (dev overlay exposes MCP on `localhost:3001`).

Mark each item PASS / FAIL as you go. Any FAIL is a blocker for handoff.

---

## 1. Stack health

- [ ] `docker compose ps` shows `db`, `mcp`, `mongodb`, `librechat` all up. `db` and `mcp` should say `(healthy)`.
- [ ] All host-facing ports show `127.0.0.1:...` (not `0.0.0.0` and not just `:port`). Specifically: db 5432, mcp 3001, librechat 3080.
- [ ] `./talos health` returns `9 passed, 0 failed` (one WARN about backup disk is fine).
- [ ] `docker compose logs --tail=20 mcp | grep warn` shows the `MCP_SKIP_AUTH=true …` startup warning (dev overlay only — correct).
- [ ] `curl -sf http://localhost:3001/health` returns `{"status":"ok"}`.

## 2. MCP tool surface via curl

Get a bearer from `secrets/agent_keys.json` first:

```bash
BEARER=$(python3 -c 'import json; print(next(iter(json.load(open("secrets/agent_keys.json")))))')
```

- [ ] `tools/list` returns at least these tools: `insert, update, delete, search, get, list_children, backlinks, recent, search_titles, fetch`.

```bash
curl -sf -X POST http://localhost:3001/mcp \
  -H "Authorization: Bearer $BEARER" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"manual-test","version":"1"}}}'
```

Grab the `mcp-session-id` response header and reuse it on subsequent calls.

## 3. MCP tests (vitest) — **partially stale**

`pnpm mcp:test` currently has ~11 failing tests in `insert.test.ts` and `update.test.ts`. The tests predate the title/type promotion (Phase 2.x), the `if_match` enforcement (Phase 4c), and the collision check (Phase 8) — mocks and expectations are out of date. See Backlog item *"Rehab MCP test suite for post-4c/8 tool contracts"*.

- [ ] `pnpm mcp:test` reports **57 passing, 11 failing** (expected). Other 8 test files (auth, chunker, db, providers, delete, fetch, search) should be clean.

## 4. TypeScript

- [ ] `pnpm typecheck` passes across both packages.

## 5. Extension build

- [ ] `pnpm ext:build` succeeds. `packages/vscode-extension/dist/extension.js` and `dist/webview/main.js` both produced.

## 6. Extension dev host

```bash
cd packages/vscode-extension && code --extensionDevelopmentPath="$(pwd)"
```

In the dev host window:

- [ ] `Talos: Set API Key` accepts the bearer from `secrets/agent_keys.json`.
- [ ] `Talos: Ping Server` shows a toast listing top-level folders (e.g., `concepts(1125), data(1536), periodic-notes(…), …`).
- [ ] The Talos activity bar icon is present; clicking it opens three views: **Entries**, **Backlinks**, **Recent**.

## 7. Tree browsing

- [ ] Entries view shows top-level folders with descendant counts.
- [ ] Expanding `data` shows subfolders (recipes, books, films, etc.).
- [ ] Expanding `data/recipes` lists recipe entries (not empty).
- [ ] Clicking an entry opens a Talos webview panel beside the tree.
- [ ] Title bar shows the entry's title; meta row shows path + colored type badge.

## 8. Markdown viewer + editor

Pick any recipe and confirm:

- [ ] Markdown renders: headings in purple, lists, code blocks, tables, etc.
- [ ] Wikilinks `[[Some Title]]` appear with the open-wikilink styling (blue, with chevrons).
- [ ] Tags `#chickpeas` appear orange with a subtle chip background.
- [ ] URLs auto-linkify.
- [ ] Typing text changes the content live; no crash.

## 9. Autosave + deferred embedding

Open any entry, then open the dev host's `Help → Toggle Developer Tools` → Console.

- [ ] Type a character, wait 2s: console shows `[talos] update <uuid> defer=true bytes=… <ms>ms` — should be ~30ms.
- [ ] Click outside the editor: another log `defer=false bytes=… <ms>ms` — ~400-800ms (embedding ran).
- [ ] Typing multiple characters in quick succession does not produce per-keystroke updates (debounce held).
- [ ] Navigating to a different entry while typing: a single `defer=false` flush fires (no duplicate).

## 10. Clickable wikilinks + tags

- [ ] Click a wikilink → opens the target entry in the same panel.
- [ ] If the wikilink resolves ambiguously (multiple title matches), a quickpick appears. Try clicking `[[2020-11-09]]` in entry `2020-11-11` (uuid `657aea7e-f1a9-4ebe-aea6-a0d9bc67dbc6`).
- [ ] Click a `#tag` → opens `/tags/<name>` stub.
- [ ] Click an external URL → opens in the browser.

## 11. Navigation history

After navigating through 3+ entries via clicks:

- [ ] Panel title bar shows **◀** and **▶** buttons.
- [ ] ◀ returns to previous entry; ▶ is enabled.
- [ ] Alt+Left / Alt+Right also work while panel focused.
- [ ] Navigating to a new entry from a mid-history position truncates forward history.

## 12. Backlinks

Pick an entry with inbound wikilinks (e.g., a concept stub):

- [ ] **Linked mentions** section appears at the bottom of the viewer.
- [ ] Clicking a row opens that source entry.
- [ ] Sidebar **Backlinks** view mirrors the inline section; updates on navigation.

## 13. Recent

- [ ] **Recent** sidebar shows the 50 most recently updated entries.
- [ ] Refresh button (title bar) updates the list.

## 14. Semantic search

- [ ] `Cmd+Shift+P → Talos: Search`. Type `hummus`. Results show `Hummus /data/recipes` with similarity %.
- [ ] Clicking a result opens that entry.
- [ ] The search button in the Entries tree title bar also opens the same quickpick.

## 15. New note creation

- [ ] **Title-bar + button** in Entries view: prompts for title, then path (prefilled `/inbox`). Creating succeeds, viewer opens on the blank entry.
- [ ] **Inline + button** on a folder in the tree: prompts for title only, path is fixed to that folder.
- [ ] Typing in the blank editor triggers autosave.

## 16. Collision detection

- [ ] `Talos: New Note` with title `Hummus` and path `/data/recipes`. Expected: modal **"A note titled 'Hummus' already exists at /data/recipes"** with **Open Existing** / **Choose Different Title** buttons.
- [ ] **Open Existing** opens the existing Hummus entry.
- [ ] **Choose Different Title** prompts for a new title; using a unique one succeeds.

## 17. ETag conflict (optional)

To simulate an external edit:

```bash
docker compose exec -T db psql -U mcp_service -d talos -c \
  "SET app.agent_id='default-agent'; UPDATE entries SET content = content || E'\n\n<!-- test -->' WHERE id = '<open-entry-uuid>';"
```

Then type a character in the editor and wait 2s.

- [ ] Modal appears: **"… was updated elsewhere while you were editing."** with **Reload** / **Overwrite** options.
- [ ] **Reload** replaces the editor content with the DB version.
- [ ] **Overwrite** writes your content over it.

Reset after:

```bash
docker compose exec -T db psql -U mcp_service -d talos -c \
  "SET app.agent_id='default-agent'; UPDATE entries SET content = regexp_replace(content, E'\n\n<!-- test -->', '') WHERE id = '<uuid>';"
```

## 18. Wikilink / tag autocomplete

In any entry's editor:

- [ ] Type `[[hum` — popup appears with title matches (Hummus, etc.). Arrow keys navigate, Enter accepts, inserts `[[Hummus]]`.
- [ ] Type `#re` — popup appears with tag-only matches (from `/tags/*`).
- [ ] Escape dismisses.
- [ ] Typing `# ` at the start of a line (a heading) does NOT trigger the tag popup.

## 19. URI handler

- [ ] From a shell: `open "vscode://talos.talos-vscode/entry/dd4e924d-600e-419b-87e1-1dacba1815be"` opens the Lemon Tahini Sauce entry.
- [ ] `open "vscode://talos.talos-vscode/entry/nope"` shows a warning toast.

## 20. Import tooling

Without actually running a vault sync, verify the scripts load correctly:

```bash
python3 -c "
import importlib.util
spec = importlib.util.spec_from_file_location('s', 'import-audit/sync-import.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
print('sync-import loaded; API_KEY is loaded from secrets')
"
```

- [ ] Prints `sync-import loaded …` (not a SystemExit about missing bearer).
- [ ] `python3 import-audit/sync-import.py --dry-run` completes without crashing (exits with SYNC PLAN output; content irrelevant here).

## 21. LibreChat (optional)

- [ ] `http://localhost:3080` loads LibreChat.
- [ ] Creating an account works.
- [ ] Talos MCP tools are reachable from a conversation (depends on LibreChat MCP config in `librechat.yaml`).

## 22. Clean teardown

- [ ] `docker compose down` stops everything cleanly.
- [ ] Starting back up with `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d` is quick (cached).
- [ ] Data persists (entries still exist after restart).
