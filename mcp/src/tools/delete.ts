import { z } from "zod";
import { withAgent } from "../db.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

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

interface DeleteParams {
  agentId: string;
  id: string;
}

export async function handleDelete(params: DeleteParams): Promise<ToolResult> {
  const { agentId, id } = params;

  try {
    const deletedId = await withAgent(agentId, async (client) => {
      const result = await client.query(
        "DELETE FROM entries WHERE id = $1 RETURNING id",
        [id]
      );
      if (result.rowCount === 0) {
        throw new Error("NOT_FOUND");
      }
      return result.rows[0].id;
    });

    return {
      content: [{ type: "text" as const, text: JSON.stringify({ deleted: deletedId }) }],
    };
  } catch (err) {
    if (err instanceof Error && err.message === "NOT_FOUND") {
      return toolError("NOT_FOUND", "Entry not found or access denied");
    }
    throw err;
  }
}

const deleteSchema = {
  id: z.string().uuid("Entry ID must be a valid UUID"),
};

export function registerDeleteTool(server: McpServer, agentId: string): void {
  server.tool(
    "delete",
    "Delete an entry and its chunks",
    deleteSchema,
    async (params) => {
      return handleDelete({ agentId, ...params });
    }
  );
}
