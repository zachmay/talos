import * as vscode from "vscode";
import { clearApiKey, ensureApiKey, getServerUrl, setApiKey } from "./config.js";
import { McpClient, McpError } from "./mcp/client.js";
import { insert, listChildren, search } from "./mcp/tools.js";
import { EntriesTreeProvider } from "./views/entries.js";
import { BacklinksTreeProvider } from "./views/backlinks.js";
import { RecentTreeProvider } from "./views/recent.js";
import { EntryPanel } from "./panel.js";

// Lazy-initialized MCP client. Created on first tool use so the extension
// doesn't prompt for an API key on activation alone.
let client: McpClient | undefined;

async function getClient(ctx: vscode.ExtensionContext): Promise<McpClient | undefined> {
  const key = await ensureApiKey(ctx);
  if (!key) {
    vscode.window.showWarningMessage("Talos: API key required.");
    return undefined;
  }
  if (!client) {
    client = new McpClient({ url: getServerUrl(), apiKey: key });
    await client.initialize();
  }
  return client;
}

interface SearchPickItem extends vscode.QuickPickItem {
  id: string;
}

// Parses "/foo/bar" or "foo/bar" into ["foo", "bar"]; drops empty segments.
function parsePath(input: string): string[] {
  return input
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Attempt a new-note insert; on COLLISION, offer Open Existing / Rename /
// Cancel. Rename loops back into itself with a fresh title prompt.
async function tryCreateNote(
  ctx: vscode.ExtensionContext,
  client: McpClient,
  title: string,
  path: string[],
  entriesProvider: EntriesTreeProvider,
  recentProvider: RecentTreeProvider,
): Promise<void> {
  try {
    const res = await insert(client, {
      title,
      type: "note",
      content: "",
      path,
      mime_type: "text/markdown",
    });
    entriesProvider.refresh();
    recentProvider.refresh();
    EntryPanel.show(ctx, () => getClient(ctx), res.id);
  } catch (err: unknown) {
    if (err instanceof McpError && err.code === "COLLISION") {
      const data = err.data as { conflicts?: string[] } | undefined;
      const existingId = data?.conflicts?.[0];
      const pick = await vscode.window.showInformationMessage(
        `A note titled "${title}" already exists at /${path.join("/")}.`,
        { modal: true },
        "Open Existing",
        "Choose Different Title",
      );
      if (pick === "Open Existing" && existingId) {
        EntryPanel.show(ctx, () => getClient(ctx), existingId);
      } else if (pick === "Choose Different Title") {
        const newTitle = await vscode.window.showInputBox({
          title: "New Talos Note — Choose Title",
          prompt: `A note titled "${title}" exists at /${path.join("/")}. Pick a different title.`,
          value: title,
          ignoreFocusOut: true,
        });
        if (newTitle && newTitle.trim() && newTitle.trim() !== title) {
          await tryCreateNote(ctx, client, newTitle.trim(), path, entriesProvider, recentProvider);
        }
      }
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Talos: create failed: ${msg}`);
  }
}

// vscode://talos.talos-vscode/entry/<uuid> opens that entry in the viewer.
// Other URI shapes (by path, by title, with query params) intentionally
// unsupported — paths aren't unique and titles require a round trip to
// resolve. UUID is the stable identifier; Claude (or any caller) can
// always search first to obtain one.
const ENTRY_URI_RE = /^\/entry\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;

export function activate(ctx: vscode.ExtensionContext): void {
  const entriesProvider = new EntriesTreeProvider(() => getClient(ctx));
  const entriesView = vscode.window.createTreeView("talos.entries", {
    treeDataProvider: entriesProvider,
    showCollapseAll: true,
  });
  ctx.subscriptions.push(entriesView);

  const backlinksProvider = new BacklinksTreeProvider(() => getClient(ctx), EntryPanel.onActiveChanged);
  const backlinksView = vscode.window.createTreeView("talos.backlinks", {
    treeDataProvider: backlinksProvider,
  });
  ctx.subscriptions.push(backlinksView);

  const recentProvider = new RecentTreeProvider(() => getClient(ctx));
  const recentView = vscode.window.createTreeView("talos.recent", {
    treeDataProvider: recentProvider,
  });
  ctx.subscriptions.push(recentView);

  ctx.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri(uri: vscode.Uri): void {
        const match = ENTRY_URI_RE.exec(uri.path);
        if (!match) {
          vscode.window.showWarningMessage(
            `Talos: unrecognized URI (${uri.path}). Expected /entry/<uuid>.`,
          );
          return;
        }
        vscode.commands.executeCommand("talos.openEntry", match[1]);
      },
    }),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand("talos.refresh", () => {
      entriesProvider.refresh();
      recentProvider.refresh();
    }),
    vscode.commands.registerCommand("talos.newNote", async (context?: { path?: string[] }) => {
      const c = await getClient(ctx);
      if (!c) return;
      // Folder-context invocation fixes the path; title-bar invocation lets
      // the user edit it (defaulting to /inbox per CLAUDE.md's "unsorted
      // captures" convention).
      const fixedPath = context?.path && context.path.length > 0 ? context.path : undefined;
      const title = await vscode.window.showInputBox({
        title: "New Talos Note",
        prompt: fixedPath ? `Title for new note in /${fixedPath.join("/")}` : "Title for new note",
        ignoreFocusOut: true,
      });
      if (!title) return;

      let path: string[];
      if (fixedPath) {
        path = fixedPath;
      } else {
        const pathInput = await vscode.window.showInputBox({
          title: "New Talos Note — Path",
          prompt: "Target path (segments separated by /)",
          value: "/inbox",
          ignoreFocusOut: true,
          validateInput: (v) => {
            const segs = parsePath(v);
            return segs.length > 0 ? undefined : "Path must have at least one segment";
          },
        });
        if (!pathInput) return;
        path = parsePath(pathInput);
      }
      await tryCreateNote(ctx, c, title.trim(), path, entriesProvider, recentProvider);
    }),
    vscode.commands.registerCommand("talos.refreshRecent", () => recentProvider.refresh()),
    vscode.commands.registerCommand("talos.search", async () => {
      const c = await getClient(ctx);
      if (!c) return;
      const qp = vscode.window.createQuickPick<SearchPickItem>();
      qp.placeholder = "Search Talos (semantic). Type and hit enter.";
      qp.matchOnDescription = true;
      qp.matchOnDetail = true;
      let seq = 0;
      qp.onDidChangeValue(async (value) => {
        const query = value.trim();
        if (query.length < 2) {
          qp.items = [];
          qp.busy = false;
          return;
        }
        const mine = ++seq;
        qp.busy = true;
        try {
          const hits = await search(c, { query, threshold: 0.4, count: 20 });
          if (mine !== seq) return; // stale response
          qp.items = hits.map((h) => ({
            label: h.title,
            description: `/${h.path.join("/")}`,
            detail: `${h.type}${h.similarity !== undefined ? ` — ${Math.round(h.similarity * 100)}%` : ""}`,
            id: h.id,
          }));
        } catch (err) {
          if (mine !== seq) return;
          qp.items = [];
        } finally {
          if (mine === seq) qp.busy = false;
        }
      });
      qp.onDidAccept(() => {
        const pick = qp.selectedItems[0];
        if (pick) EntryPanel.show(ctx, () => getClient(ctx), pick.id);
        qp.hide();
      });
      qp.onDidHide(() => qp.dispose());
      qp.show();
    }),
    vscode.commands.registerCommand("talos.openEntry", (id: string) => {
      EntryPanel.show(ctx, () => getClient(ctx), id);
    }),
    vscode.commands.registerCommand("talos.navigateBack", () => EntryPanel.instance?.navigateBack()),
    vscode.commands.registerCommand("talos.navigateForward", () => EntryPanel.instance?.navigateForward()),
    vscode.commands.registerCommand("talos.openWikilink", async (target: string) => {
      const c = await getClient(ctx);
      if (!c) return;
      let hits;
      try {
        // Path-only search with a title column filter — avoids a semantic
        // pass, gives us every entry whose title matches exactly.
        hits = await search(c, { path: [], filter: { title: target }, count: 5 });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Talos: search failed: ${msg}`);
        return;
      }
      if (hits.length === 0) {
        vscode.window.showInformationMessage(`Talos: no entry titled "${target}"`);
        return;
      }
      if (hits.length === 1) {
        EntryPanel.show(ctx, () => getClient(ctx), hits[0].id);
        return;
      }
      const pick = await vscode.window.showQuickPick(
        hits.map((h) => ({
          label: h.title,
          description: `/${h.path.join("/")}`,
          detail: h.type,
          id: h.id,
        })),
        { placeHolder: `Multiple entries titled "${target}"` },
      );
      if (pick) EntryPanel.show(ctx, () => getClient(ctx), pick.id);
    }),
    vscode.commands.registerCommand("talos.openTag", async (name: string) => {
      const c = await getClient(ctx);
      if (!c) return;
      try {
        const hits = await search(c, { path: ["tags", name], count: 1 });
        if (hits[0]) {
          EntryPanel.show(ctx, () => getClient(ctx), hits[0].id);
        } else {
          vscode.window.showInformationMessage(`Talos: no tag stub "${name}"`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Talos: search failed: ${msg}`);
      }
    }),
    vscode.commands.registerCommand("talos.setApiKey", async () => {
      const input = await vscode.window.showInputBox({
        title: "Talos API Key",
        prompt: "Paste your Talos MCP bearer token.",
        password: true,
        ignoreFocusOut: true,
      });
      if (input) {
        await setApiKey(ctx, input);
        client = undefined;
        entriesProvider.refresh();
        vscode.window.showInformationMessage("Talos: API key stored.");
      }
    }),
    vscode.commands.registerCommand("talos.clearApiKey", async () => {
      await clearApiKey(ctx);
      client = undefined;
      entriesProvider.refresh();
      vscode.window.showInformationMessage("Talos: API key cleared.");
    }),
    vscode.commands.registerCommand("talos.ping", async () => {
      const c = await getClient(ctx);
      if (!c) return;
      try {
        const res = await listChildren(c, []);
        const counts = res.folders.map((f) => `${f.path.join("/")}(${f.descendants})`).join(", ");
        vscode.window.showInformationMessage(`Talos: ${res.folders.length} top-level folders — ${counts}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Talos ping failed: ${msg}`);
      }
    }),
  );
}

export function deactivate(): void {
  client = undefined;
}
