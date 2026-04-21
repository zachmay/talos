import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { withAgent } from "../db.js";

interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: true;
}

// Returns entries whose link edges target the given entry id.
// Each result row: {source_id, source_title, source_path, source_type, link_type, link_text}
export async function _handleBacklinks(id: string, agentId: string): Promise<ToolResult> {
  const rows = await withAgent(agentId, async (client) => {
    const result = await client.query(
      `SELECT
         e.id AS source_id,
         e.title AS source_title,
         e.path AS source_path,
         e.type AS source_type,
         l.link_type,
         l.link_text
       FROM links l
       JOIN entries e ON e.id = l.source_id
       WHERE l.target_id = $1
       ORDER BY e.title`,
      [id]
    );
    return result.rows;
  });

  const backlinks = rows.map((r: any) => ({
    source_id: r.source_id,
    source_title: r.source_title,
    source_path: r.source_path ?? [],
    source_type: r.source_type,
    link_type: r.link_type,
    link_text: r.link_text,
  }));

  return {
    content: [{ type: "text" as const, text: JSON.stringify({ id, backlinks }) }],
  };
}

export function registerBacklinksTool(server: McpServer, agentId: string): void {
  server.tool(
    "backlinks",
    "List entries that link to the given entry. Returns source_id, source_title, source_path, source_type, link_type (wikilink/tag/embed/mention), and link_text for each inbound edge.",
    { id: z.string().uuid("Entry ID must be a valid UUID") },
    async ({ id }) => _handleBacklinks(id, agentId),
  );
}
