import * as vscode from "vscode";
import { McpClient } from "./mcp/client.js";
import { get as getEntry, update as updateEntry } from "./mcp/tools.js";

// Shape of messages from the webview. Kept in sync with src/webview/types.ts.
type WebviewMessage =
  | { type: "ready" }
  | { type: "get-entry"; id: string }
  | {
      type: "update-entry";
      id: string;
      title: string;
      type_: string;
      mime_type: string;
      path: string[];
      content: string;
      metadata: Record<string, unknown> | null;
      defer: boolean;
    }
  | { type: "invoke-command"; command: string; arg: string };

// Commands the webview is allowed to invoke via the bridge. Allowlisted so
// the webview can't trigger arbitrary extension commands.
const WEBVIEW_INVOKABLE_COMMANDS = new Set([
  "talos.openEntry",
  "talos.openWikilink",
  "talos.openTag",
]);

// Manages a single "Entry Viewer" webview panel. The panel is reused across
// talos.openEntry invocations — we reveal it and send a new open-entry message
// rather than spawning a fresh panel each time.
//
// Navigation history follows browser semantics: navigating to a new entry
// truncates any forward history; back/forward move the cursor without
// mutating the stack.
export class EntryPanel {
  private static current: EntryPanel | undefined;

  static show(ctx: vscode.ExtensionContext, getClient: () => Promise<McpClient | undefined>, id: string): void {
    if (EntryPanel.current) {
      EntryPanel.current.panel.reveal(vscode.ViewColumn.Beside);
      EntryPanel.current.navigateTo(id);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "talos.entry",
      "Talos",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      {
        enableScripts: true,
        enableCommandUris: ["talos.openEntry", "talos.openWikilink", "talos.openTag"],
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(ctx.extensionUri, "dist", "webview"),
          vscode.Uri.joinPath(ctx.extensionUri, "media"),
        ],
      },
    );
    EntryPanel.current = new EntryPanel(ctx, panel, getClient);
    EntryPanel.current.navigateTo(id);
  }

  static get instance(): EntryPanel | undefined {
    return EntryPanel.current;
  }

  private readonly history: string[] = [];
  private cursor = -1;
  private readyReceived = false;
  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly panel: vscode.WebviewPanel,
    private readonly getClient: () => Promise<McpClient | undefined>,
  ) {
    panel.webview.html = this.renderHtml();
    this.disposables.push(
      panel.onDidDispose(() => this.dispose()),
      panel.webview.onDidReceiveMessage((msg: WebviewMessage) => this.onMessage(msg)),
    );
  }

  navigateTo(id: string): void {
    // No-op if navigating to the currently displayed entry.
    if (this.history[this.cursor] === id) return;
    // Truncate forward history — classic browser semantics.
    this.history.length = this.cursor + 1;
    this.history.push(id);
    this.cursor = this.history.length - 1;
    this.syncNavContext();
    if (this.readyReceived) this.fetchAndSend(id);
  }

  navigateBack(): void {
    if (this.cursor <= 0) return;
    this.cursor--;
    this.syncNavContext();
    this.fetchAndSend(this.history[this.cursor]);
  }

  navigateForward(): void {
    if (this.cursor >= this.history.length - 1) return;
    this.cursor++;
    this.syncNavContext();
    this.fetchAndSend(this.history[this.cursor]);
  }

  private syncNavContext(): void {
    // Context keys let package.json gate the back/forward buttons' enablement.
    vscode.commands.executeCommand("setContext", "talos.canNavigateBack", this.cursor > 0);
    vscode.commands.executeCommand("setContext", "talos.canNavigateForward", this.cursor < this.history.length - 1);
  }

  private async onMessage(msg: WebviewMessage): Promise<void> {
    if (msg.type === "ready") {
      this.readyReceived = true;
      const current = this.history[this.cursor];
      if (current) this.fetchAndSend(current);
    } else if (msg.type === "get-entry") {
      this.fetchAndSend(msg.id);
    } else if (msg.type === "update-entry") {
      this.handleUpdate(msg);
    } else if (msg.type === "invoke-command") {
      if (WEBVIEW_INVOKABLE_COMMANDS.has(msg.command)) {
        vscode.commands.executeCommand(msg.command, msg.arg);
      }
    }
  }

  private async handleUpdate(msg: Extract<WebviewMessage, { type: "update-entry" }>): Promise<void> {
    const client = await this.getClient();
    if (!client) {
      this.panel.webview.postMessage({
        type: "entry-error",
        id: msg.id,
        error: "No API key configured",
      });
      return;
    }
    const t0 = Date.now();
    try {
      // Per decision: always send the full mutable surface (title, path,
      // mime_type, metadata) even when only content changed. Keeps the
      // update path uniform regardless of which field the UI exposed.
      await updateEntry(client, {
        id: msg.id,
        title: msg.title,
        type: msg.type_,
        mime_type: msg.mime_type,
        content: msg.content,
        metadata: msg.metadata,
        defer_embedding: msg.defer,
      });
      console.log(
        `[talos] update ${msg.id} defer=${msg.defer} bytes=${msg.content.length} ${Date.now() - t0}ms`,
      );
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[talos] update ${msg.id} failed: ${errMsg}`);
      vscode.window.showErrorMessage(`Talos: save failed: ${errMsg}`);
    }
  }

  private async fetchAndSend(id: string): Promise<void> {
    const client = await this.getClient();
    if (!client) {
      this.panel.webview.postMessage({ type: "entry-error", id, error: "No API key configured" });
      return;
    }
    try {
      const entry = await getEntry(client, id);
      this.panel.title = entry.title || "Talos";
      this.panel.webview.postMessage({ type: "entry-loaded", entry });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.panel.webview.postMessage({ type: "entry-error", id, error: msg });
    }
  }

  private renderHtml(): string {
    const { webview } = this.panel;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.ctx.extensionUri, "dist", "webview", "main.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.ctx.extensionUri, "media", "viewer.css"),
    );
    const nonce = randomNonce();
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri}">
  <title>Talos</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private dispose(): void {
    EntryPanel.current = undefined;
    vscode.commands.executeCommand("setContext", "talos.canNavigateBack", false);
    vscode.commands.executeCommand("setContext", "talos.canNavigateForward", false);
    for (const d of this.disposables) d.dispose();
  }
}

function randomNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
