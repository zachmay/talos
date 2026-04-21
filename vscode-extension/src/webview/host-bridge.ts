// HostBridge: abstract channel from the webview UI to whatever is hosting it.
//
// VsCodeBridge posts messages to the extension host; a future DirectBridge
// (for a standalone web app) would talk straight to the Talos MCP over HTTP.
//
// The UI depends only on the interface — swapping transports is a one-line
// change in main.tsx.

import type { Entry, HostMessage, WebviewMessage } from "./types";

export interface HostBridge {
  getEntry(id: string): Promise<Entry>;
  onMessage(handler: (msg: HostMessage) => void): () => void;
  notifyReady(): void;
}

// Shape of the object VS Code injects into the webview.
interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

export class VsCodeBridge implements HostBridge {
  private readonly vscode: VsCodeApi = acquireVsCodeApi();
  private readonly pending = new Map<string, { resolve: (e: Entry) => void; reject: (err: Error) => void }>();
  private readonly handlers = new Set<(msg: HostMessage) => void>();

  constructor() {
    window.addEventListener("message", (event) => {
      const msg = event.data as HostMessage;
      if (msg.type === "entry-loaded") {
        const pending = this.pending.get(msg.entry.id);
        if (pending) {
          this.pending.delete(msg.entry.id);
          pending.resolve(msg.entry);
        }
      } else if (msg.type === "entry-error") {
        const pending = this.pending.get(msg.id);
        if (pending) {
          this.pending.delete(msg.id);
          pending.reject(new Error(msg.error));
        }
      }
      for (const h of this.handlers) h(msg);
    });
  }

  getEntry(id: string): Promise<Entry> {
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.post({ type: "get-entry", id });
    });
  }

  onMessage(handler: (msg: HostMessage) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  notifyReady(): void {
    this.post({ type: "ready" });
  }

  private post(msg: WebviewMessage): void {
    this.vscode.postMessage(msg);
  }
}
