import * as vscode from "vscode";
import { McpClient } from "./mcp/client.js";
import { get as getEntry } from "./mcp/tools.js";

// Shape of messages from the webview. Kept in sync with src/webview/types.ts.
type WebviewMessage = { type: "ready" } | { type: "get-entry"; id: string };

// Manages a single "Entry Viewer" webview panel. The panel is reused across
// talos.openEntry invocations — we reveal it and send a new open-entry message
// rather than spawning a fresh panel each time.
export class EntryPanel {
  private static current: EntryPanel | undefined;

  static show(ctx: vscode.ExtensionContext, getClient: () => Promise<McpClient | undefined>, id: string): void {
    if (EntryPanel.current) {
      EntryPanel.current.panel.reveal(vscode.ViewColumn.Beside);
      EntryPanel.current.openEntry(id);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "talos.entry",
      "Talos",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(ctx.extensionUri, "dist", "webview"),
          vscode.Uri.joinPath(ctx.extensionUri, "media"),
        ],
      },
    );
    EntryPanel.current = new EntryPanel(ctx, panel, getClient);
    EntryPanel.current.openEntry(id);
  }

  private pendingId: string | undefined;
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

  openEntry(id: string): void {
    this.pendingId = id;
    if (this.readyReceived) {
      this.fetchAndSend(id);
    }
  }

  private async onMessage(msg: WebviewMessage): Promise<void> {
    if (msg.type === "ready") {
      this.readyReceived = true;
      if (this.pendingId) this.fetchAndSend(this.pendingId);
    } else if (msg.type === "get-entry") {
      this.fetchAndSend(msg.id);
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
    for (const d of this.disposables) d.dispose();
  }
}

function randomNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
