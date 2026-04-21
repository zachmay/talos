import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { withAgent } from "../db.js";

interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: true;
}

function toolError(code: string, message: string): ToolResult {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: code, message }) }],
    isError: true,
  };
}

export async function _handleGet(id: string, agentId: string): Promise<ToolResult> {
  const row = await withAgent(agentId, async (client) => {
    const result = await client.query(
      `SELECT id, title, type, mime_type, path, content, metadata, created_at, updated_at
       FROM entries WHERE id = $1`,
      [id]
    );
    return result.rows[0] ?? null;
  });

  if (!row) {
    return toolError("NOT_FOUND", "Entry not found or access denied");
  }

  return {
    content: [{ type: "text" as const, text: JSON.stringify({
      id: row.id,
      title: row.title,
      type: row.type,
      mime_type: row.mime_type,
      path: row.path ?? [],
      content: row.content,
      metadata: row.metadata,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }) }],
  };
}

export function registerGetTool(server: McpServer, agentId: string): void {
  server.tool(
    "get",
    "Fetch a single entry by UUID. Returns all fields: title, type, mime_type, path, content, metadata, created_at, updated_at.",
    { id: z.string().uuid("Entry ID must be a valid UUID") },
    async ({ id }) => _handleGet(id, agentId),
  );
}
