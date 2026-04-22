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
  etag: string;
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

export interface InsertArgs {
  title: string;
  type: string;
  content: string;
  path?: string[];
  mime_type?: string;
  metadata?: Record<string, unknown>;
}

export interface InsertResult {
  id: string;
  title: string;
  type: string;
  mime_type: string;
  content: string | null;
  path: string[];
}

export async function insert(client: McpClient, args: InsertArgs): Promise<InsertResult> {
  return client.callTool<InsertResult>("insert", { ...args });
}

export interface UpdateArgs {
  id: string;
  if_match: string;
  content?: string;
  title?: string;
  type?: string;
  mime_type?: string;
  metadata?: Record<string, unknown> | null;
  defer_embedding?: boolean;
}

export interface UpdateResult {
  id: string;
  title: string;
  type: string;
  mime_type: string;
  content: string | null;
  path: string[];
  etag: string;
  deferred?: boolean;
}

export async function update(client: McpClient, args: UpdateArgs): Promise<UpdateResult> {
  // MCP update rejects `null` for metadata — we send an empty object instead.
  const payload: Record<string, unknown> = { ...args };
  if (payload.metadata === null) payload.metadata = {};
  return client.callTool<UpdateResult>("update", payload);
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

export interface RecentHit {
  id: string;
  title: string;
  type: string;
  mime_type: string;
  path: string[];
  updated_at: string;
  etag: string;
}

export async function recent(client: McpClient, limit = 50): Promise<RecentHit[]> {
  return client.callTool<RecentHit[]>("recent", { limit });
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

export async function searchTitles(client: McpClient, args: SearchTitlesArgs): Promise<TitleHit[]> {
  return client.callTool<TitleHit[]>("search_titles", { ...args });
}
