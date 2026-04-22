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
  // Content-hash of (title, path, content, metadata-minus-_import). Sent back
  // as if_match on subsequent updates; server rejects stale writes.
  etag: string;
}

export interface Backlink {
  source_id: string;
  source_title: string;
  source_path: string[];
  source_type: string;
  link_type: "wikilink" | "tag" | "embed" | "mention";
  link_text: string;
}

export interface TitleHit {
  id: string;
  title: string;
  type: string;
  path: string[];
}

export interface SearchTitlesArgs {
  query: string;
  limit?: number;
  path_prefix?: string[];
  type?: string;
}

// Messages from extension host → webview
export type HostMessage =
  | { type: "entry-loaded"; entry: Entry; backlinks: Backlink[] }
  // Sent after a successful update — lets the webview advance its stored
  // etag so the next update uses a fresh one. Content is unchanged; no
  // editor remount.
  | { type: "entry-updated"; id: string; etag: string }
  | { type: "entry-error"; id: string; error: string }
  | { type: "search-titles-result"; request_id: number; hits: TitleHit[] }
  | { type: "search-titles-error"; request_id: number; error: string };

// Messages from webview → extension host
export type WebviewMessage =
  | { type: "ready" }
  | { type: "get-entry"; id: string }
  | {
      type: "update-entry";
      id: string;
      if_match: string;
      title: string;
      type_: string;
      mime_type: string;
      path: string[];
      content: string;
      metadata: Record<string, unknown> | null;
      defer: boolean;
    }
  | { type: "invoke-command"; command: string; arg: string }
  | { type: "search-titles"; request_id: number; args: SearchTitlesArgs };
