// Typed wrappers over the MCP tools the extension uses.
//
// These mirror the server-side tool contracts. Each function takes an
// initialized McpClient and returns a parsed, typed result.

import { McpClient } from "./client.js";

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

export interface ListChildrenResult {
  path: string[];
  entries: Array<{
    id: string;
    title: string;
    type: string;
    mime_type: string;
  }>;
  folders: Array<{
    path: string[];
    descendants: number;
  }>;
}

export interface Backlink {
  source_id: string;
  source_title: string;
  source_path: string[];
  source_type: string;
  link_type: "wikilink" | "tag" | "embed" | "mention";
  link_text: string;
}

export interface BacklinksResult {
  id: string;
  backlinks: Backlink[];
}

export interface SearchHit {
  id: string;
  title: string;
  type: string;
  mime_type: string;
  content: string | null;
  path: string[];
  similarity?: number;
  metadata?: Record<string, unknown>;
}

export async function get(client: McpClient, id: string): Promise<Entry> {
  return client.callTool<Entry>("get", { id });
}

export interface UpdateArgs {
  id: string;
  content?: string;
  title?: string;
  type?: string;
  mime_type?: string;
  metadata?: Record<string, unknown> | null;
}

export async function update(client: McpClient, args: UpdateArgs): Promise<{ id: string }> {
  // MCP update rejects `null` for metadata — we send an empty object instead.
  const payload: Record<string, unknown> = { ...args };
  if (payload.metadata === null) payload.metadata = {};
  return client.callTool<{ id: string }>("update", payload);
}

export async function listChildren(client: McpClient, path: string[]): Promise<ListChildrenResult> {
  return client.callTool<ListChildrenResult>("list_children", { path });
}

export async function backlinks(client: McpClient, id: string): Promise<BacklinksResult> {
  return client.callTool<BacklinksResult>("backlinks", { id });
}

export interface SearchArgs {
  query?: string;
  path?: string[];
  filter?: Record<string, unknown>;
  threshold?: number;
  count?: number;
  verbose?: boolean;
}

export async function search(client: McpClient, args: SearchArgs): Promise<SearchHit[]> {
  return client.callTool<SearchHit[]>("search", args as Record<string, unknown>);
}
