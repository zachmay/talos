import * as vscode from "vscode";
import { clearApiKey, ensureApiKey, getServerUrl, setApiKey } from "./config.js";
import { McpClient } from "./mcp/client.js";
import { listChildren } from "./mcp/tools.js";
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

export function activate(ctx: vscode.ExtensionContext): void {
  const entriesProvider = new EntriesTreeProvider(() => getClient(ctx));
  const entriesView = vscode.window.createTreeView("talos.entries", {
    treeDataProvider: entriesProvider,
    showCollapseAll: true,
  });
  ctx.subscriptions.push(entriesView);

  ctx.subscriptions.push(
    vscode.commands.registerCommand("talos.refresh", () => entriesProvider.refresh()),
    vscode.commands.registerCommand("talos.openEntry", (id: string) => {
      EntryPanel.show(ctx, () => getClient(ctx), id);
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
