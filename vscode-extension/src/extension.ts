import * as vscode from "vscode";
import { clearApiKey, ensureApiKey, getServerUrl, setApiKey } from "./config.js";
import { McpClient } from "./mcp/client.js";
import { listChildren, search } from "./mcp/tools.js";
import { EntriesTreeProvider } from "./views/entries.js";
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
    vscode.commands.registerCommand("talos.refresh", () => entriesProvider.refresh()),
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
