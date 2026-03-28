import { z } from "zod";
import { withAgent } from "../db.js";
import { withAudit } from "../audit.js";
import { chunkText } from "../chunker.js";
import { createEmbeddingProvider } from "../providers/interface.js";
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

interface UpdateParams {
  agentId: string;
  id: string;
  content?: string;
  metadata?: Record<string, unknown>;
  chunk_size?: number;
  chunk_overlap?: number;
  verbose?: boolean;
}

export async function handleUpdate(params: UpdateParams): Promise<ToolResult> {
  const { agentId, id, content, metadata, verbose } = params;

  // Validate: at least one of content or metadata
  if (!content && !metadata) {
    return toolError("VALIDATION_ERROR", "At least one of content or metadata must be provided");
  }

  // Validate: content must not be empty string
  if (content !== undefined && content.trim().length === 0) {
    return toolError("VALIDATION_ERROR", "Content must not be empty");
  }

  const chunkSize = params.chunk_size ?? parseInt(process.env.CHUNK_SIZE ?? "2000", 10);
  const chunkOverlap = params.chunk_overlap ?? parseInt(process.env.CHUNK_OVERLAP ?? "200", 10);

  // Content update path: chunk + embed BEFORE transaction
  if (content) {
    const provider = createEmbeddingProvider();
    const chunks = chunkText(content, chunkSize, chunkOverlap);

    let embeddings: number[][];
    try {
      embeddings = await Promise.all(chunks.map((c) => provider.embed(c)));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return toolError("EMBEDDING_FAILED", msg);
    }

    let row: any;
    try {
      row = await withAgent(agentId, async (client) => {
        return withAudit(client, agentId, "update", id, {}, async () => {
          // Delete old chunks
          await client.query("DELETE FROM chunks WHERE entry_id = $1", [id]);

          // Update entry content (+ metadata if provided)
          const updateFields = metadata
            ? "content = $2, metadata = $3, updated_at = NOW()"
            : "content = $2, updated_at = NOW()";
          const updateParams = metadata ? [id, content, JSON.stringify(metadata)] : [id, content];
          const returning = verbose
            ? "id, content, path, metadata, updated_at"
            : "id, content, path";
          const updateResult = await client.query(
            `UPDATE entries SET ${updateFields} WHERE id = $1 RETURNING ${returning}`,
            updateParams
          );

          if (updateResult.rowCount === 0) {
            throw new Error("NOT_FOUND");
          }

          // Insert new chunks
          for (let i = 0; i < chunks.length; i++) {
            await client.query(
              "INSERT INTO chunks (entry_id, chunk_index, embedding) VALUES ($1, $2, $3)",
              [id, i, JSON.stringify(embeddings[i])]
            );
          }

          return updateResult.rows[0];
        });
      });
    } catch (err) {
      if (err instanceof Error && err.message === "NOT_FOUND") {
        return toolError("NOT_FOUND", "Entry not found or access denied");
      }
      throw err;
    }

    const response: Record<string, unknown> = {
      id: row.id,
      content: row.content,
      path: row.path,
    };
    if (verbose) {
      response.metadata = row.metadata;
      response.updated_at = row.updated_at;
      response.chunk_count = chunks.length;
    }

    return {
      content: [{ type: "text" as const, text: JSON.stringify(response) }],
    };
  }

  // Metadata-only path
  let row: any;
  try {
    row = await withAgent(agentId, async (client) => {
      return withAudit(client, agentId, "update", id, {}, async () => {
        const returning = verbose
          ? "id, content, path, metadata, updated_at"
          : "id, content, path";
        const result = await client.query(
          `UPDATE entries SET metadata = $2, updated_at = NOW() WHERE id = $1 RETURNING ${returning}`,
          [id, JSON.stringify(metadata)]
        );
        if (result.rowCount === 0) {
          throw new Error("NOT_FOUND");
        }
        return result.rows[0];
      });
    });
  } catch (err) {
    if (err instanceof Error && err.message === "NOT_FOUND") {
      return toolError("NOT_FOUND", "Entry not found or access denied");
    }
    throw err;
  }

  const response: Record<string, unknown> = {
    id: row.id,
    content: row.content,
    path: row.path,
  };
  if (verbose) {
    response.metadata = row.metadata;
    response.updated_at = row.updated_at;
  }

  return {
    content: [{ type: "text" as const, text: JSON.stringify(response) }],
  };
}

const updateSchema = {
  id: z.string().uuid("Entry ID must be a valid UUID"),
  content: z.string().min(1).max(50_000).optional(),
  metadata: z.record(z.unknown()).optional(),
  chunk_size: z.number().int().positive().optional(),
  chunk_overlap: z.number().int().min(0).optional(),
  verbose: z.boolean().optional(),
};

export function registerUpdateTool(server: McpServer, agentId: string): void {
  server.tool(
    "update",
    "Update an entry's content (with re-embedding) and/or metadata",
    updateSchema,
    async (params) => {
      return handleUpdate({ agentId, ...params });
    }
  );
}
