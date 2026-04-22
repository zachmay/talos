import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { withAgent } from "../db.js";

interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: true;
}

// Lightweight ILIKE title search — purpose-built for autocomplete popups where
// semantic relevance is overkill and what you want is "titles containing this
// substring, fast." Case-insensitive; matches substring, not prefix only,
// because Obsidian-style autocomplete users expect that.
export async function _handleSearchTitles(
  args: { query: string; limit?: number; path_prefix?: string[]; type?: string },
  agentId: string,
): Promise<ToolResult> {
  const { query, limit = 20, path_prefix, type } = args;
  if (!query || !query.trim()) {
    return { content: [{ type: "text" as const, text: JSON.stringify([]) }] };
  }

  const rows = await withAgent(agentId, async (client) => {
    const conditions: string[] = ["title ILIKE $1"];
    const values: unknown[] = [`%${query}%`];
    let p = 2;
    if (path_prefix && path_prefix.length > 0) {
      conditions.push(`path[1:${path_prefix.length}] = $${p++}::text[]`);
      values.push(path_prefix);
    }
    if (type) {
      conditions.push(`type = $${p++}`);
      values.push(type);
    }
    values.push(limit);
    const sql = `SELECT id, title, type, path
                 FROM entries
                 WHERE ${conditions.join(" AND ")}
                 ORDER BY title
                 LIMIT $${p}`;
    const result = await client.query(sql, values);
    return result.rows;
  });

  const results = rows.map((r: any) => ({
    id: r.id,
    title: r.title,
    type: r.type,
    path: r.path ?? [],
  }));
  return { content: [{ type: "text" as const, text: JSON.stringify(results) }] };
}

export function registerSearchTitlesTool(server: McpServer, agentId: string): void {
  server.tool(
    "search_titles",
    "Substring (ILIKE) search over entry titles. Purpose-built for autocomplete: returns id/title/type/path (no content or embeddings). Optional path_prefix and type filters narrow the result set.",
    {
      query: z.string().min(1),
      limit: z.number().int().positive().max(100).default(20),
      path_prefix: z.array(z.string()).optional(),
      type: z.string().min(1).optional(),
    },
    async (args) => _handleSearchTitles(args as any, agentId),
  );
}
