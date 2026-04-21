import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { withAgent } from "../db.js";
import { computeEtag } from "../etag.js";

interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: true;
}

// Return the N most recently updated entries. `search` can't express this
// (it orders path-only by created_at and otherwise is semantic); a dedicated
// tool keeps the tree/sidebar "Recent" view fast and intention-clear.
export async function _handleRecent(limit: number, agentId: string): Promise<ToolResult> {
  const rows = await withAgent(agentId, async (client) => {
    const result = await client.query(
      `SELECT id, title, type, mime_type, path, content, metadata, updated_at
       FROM entries
       ORDER BY updated_at DESC
       LIMIT $1`,
      [limit],
    );
    return result.rows;
  });

  const results = rows.map((row: any) => ({
    id: row.id,
    title: row.title,
    type: row.type,
    mime_type: row.mime_type,
    path: row.path ?? [],
    updated_at: row.updated_at,
    etag: computeEtag({
      title: row.title,
      path: row.path,
      content: row.content,
      metadata: row.metadata,
    }),
  }));

  return {
    content: [{ type: "text" as const, text: JSON.stringify(results) }],
  };
}

export function registerRecentTool(server: McpServer, agentId: string): void {
  server.tool(
    "recent",
    "List the N most recently updated entries (ordered by updated_at DESC). Returns id, title, type, mime_type, path, updated_at, etag per entry.",
    { limit: z.number().int().positive().max(500).default(50) },
    async ({ limit }) => _handleRecent(limit, agentId),
  );
}
