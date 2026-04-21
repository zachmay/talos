// Types shared between the extension host and the webview UI.
//
// The webview UI imports these at build time (esbuild inlines them), and the
// extension host uses them to type the messages it posts. Keep this file pure
// — no runtime dependencies.

export interface Entry {
  id: string;
  title: string;
  type: string;
  mime_type: string;
  path: string[];
  content: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

// Messages from extension host → webview
export type HostMessage =
  | { type: "entry-loaded"; entry: Entry }
  | { type: "entry-error"; id: string; error: string };

// Messages from webview → extension host
export type WebviewMessage =
  | { type: "ready" }
  | { type: "get-entry"; id: string };
