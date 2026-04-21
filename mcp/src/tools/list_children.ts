import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { withAgent } from "../db.js";

interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: true;
}

// Returns the direct children of a path prefix, as two lists:
//   - entries: entries whose path equals the prefix exactly (the leaves at this level)
//   - folders: distinct subpath buckets (prefix + one more segment) with descendant counts
//
// In Talos, an entry's `path` is its container — a recipe at /data/recipes has path
// ["data","recipes"] and its title is its leaf. So listing children of /data/recipes
// returns all recipe entries (entries-at-path) plus any deeper subpath groupings.
export async function _handleListChildren(path: string[], agentId: string): Promise<ToolResult> {
  const prefixLen = path.length;

  const { entries, folders } = await withAgent(agentId, async (client) => {
    const entriesResult = await client.query(
      `SELECT id, title, type, mime_type
       FROM entries
       WHERE path = $1
       ORDER BY title`,
      [path]
    );

    const foldersResult = await client.query(
      `SELECT path[1:$1 + 1] AS child_path, COUNT(*)::int AS descendants
       FROM entries
       WHERE array_length(path, 1) > $1
         AND ($1 = 0 OR path[1:$1] = $2)
       GROUP BY path[1:$1 + 1]
       ORDER BY path[1:$1 + 1]`,
      [prefixLen, path]
    );

    return {
      entries: entriesResult.rows.map((r: any) => ({
        id: r.id,
        title: r.title,
        type: r.type,
        mime_type: r.mime_type,
      })),
      folders: foldersResult.rows.map((r: any) => ({
        path: r.child_path,
        descendants: r.descendants,
      })),
    };
  });

  return {
    content: [{ type: "text" as const, text: JSON.stringify({ path, entries, folders }) }],
  };
}

export function registerListChildrenTool(server: McpServer, agentId: string): void {
  server.tool(
    "list_children",
    "List direct children of a path prefix. Returns { entries, folders }: entries are rows whose path equals the prefix exactly; folders are distinct subpath buckets one segment deeper, with descendant counts.",
    {
      path: z.array(z.string()).describe("Path prefix. Empty array lists top-level folders."),
    },
    async ({ path }) => _handleListChildren(path, agentId),
  );
}
