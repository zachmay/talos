import { z } from "zod";
import { withAgent } from "../db.js";

import { chunkText } from "../chunker.js";
import { createEmbeddingProvider } from "../providers/interface.js";
import { scanAndStoreLinks, DanglingLinkError, AmbiguousLinkError } from "../links.js";
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
  title?: string;
  type?: string;
  mime_type?: string;
  metadata?: Record<string, unknown>;
  chunk_size?: number;
  chunk_overlap?: number;
  verbose?: boolean;
  // When true + content is provided: skip the expensive derived work
  // (chunking, embedding, link rescanning). Content is still written to the
  // entries row; chunks stay at their prior (now stale) embedding. Intended
  // for autosave; the client should issue a non-defer update on blur,
  // navigate-away, or panel close to catch the embeddings up.
  defer_embedding?: boolean;
}

export async function handleUpdate(params: UpdateParams): Promise<ToolResult> {
  const { agentId, id, content, title, type, mime_type, metadata, verbose, defer_embedding } = params;

  // Validate: at least one updatable field
  if (
    content === undefined &&
    title === undefined &&
    type === undefined &&
    mime_type === undefined &&
    metadata === undefined
  ) {
    return toolError(
      "VALIDATION_ERROR",
      "At least one of content, title, type, mime_type, or metadata must be provided"
    );
  }

  // Validate: content must not be empty string
  if (content !== undefined && content.trim().length === 0) {
    return toolError("VALIDATION_ERROR", "Content must not be empty");
  }

  const chunkSize = params.chunk_size ?? parseInt(process.env.CHUNK_SIZE ?? "2000", 10);
  const chunkOverlap = params.chunk_overlap ?? parseInt(process.env.CHUNK_OVERLAP ?? "200", 10);

  // Build SET clause dynamically for whatever fields were provided
  const setClauses: string[] = [];
  const values: any[] = [id];
  let p = 2;
  if (content !== undefined) { setClauses.push(`content = $${p++}`); values.push(content); }
  if (title !== undefined) { setClauses.push(`title = $${p++}`); values.push(title); }
  if (type !== undefined) { setClauses.push(`type = $${p++}`); values.push(type); }
  if (mime_type !== undefined) { setClauses.push(`mime_type = $${p++}`); values.push(mime_type); }
  if (metadata !== undefined) { setClauses.push(`metadata = $${p++}`); values.push(JSON.stringify(metadata)); }
  setClauses.push(`updated_at = NOW()`);

  const returningCols = verbose
    ? "id, title, type, mime_type, content, path, metadata, updated_at"
    : "id, title, type, mime_type, content, path";

  // Deferred path: write content only, no chunking/embedding, no link rescan.
  // Chunks remain stale until a non-defer update runs. See UpdateParams docs.
  if (content !== undefined && defer_embedding) {
    let row: any;
    try {
      row = await withAgent(agentId, async (client) => {
        const result = await client.query(
          `UPDATE entries SET ${setClauses.join(", ")} WHERE id = $1 RETURNING ${returningCols}`,
          values
        );
        if (result.rowCount === 0) throw new Error("NOT_FOUND");
        return result.rows[0];
      });
    } catch (err) {
      if (err instanceof Error && err.message === "NOT_FOUND") {
        return toolError("NOT_FOUND", "Entry not found or access denied");
      }
      throw err;
    }
    const response: Record<string, unknown> = {
      id: row.id,
      title: row.title,
      type: row.type,
      mime_type: row.mime_type,
      content: row.content,
      path: row.path,
      deferred: true,
    };
    if (verbose) {
      response.metadata = row.metadata;
      response.updated_at = row.updated_at;
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
  }

  // Content update path: chunk + embed BEFORE transaction
  if (content !== undefined) {
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
        await client.query("DELETE FROM chunks WHERE entry_id = $1", [id]);

        const updateResult = await client.query(
          `UPDATE entries SET ${setClauses.join(", ")} WHERE id = $1 RETURNING ${returningCols}`,
          values
        );

        if (updateResult.rowCount === 0) {
          throw new Error("NOT_FOUND");
        }

        for (let i = 0; i < chunks.length; i++) {
          await client.query(
            "INSERT INTO chunks (entry_id, chunk_idx, chunk_text, embedding, agent_id) VALUES ($1, $2, $3, $4, $5)",
            [id, i, chunks[i], JSON.stringify(embeddings[i]), agentId]
          );
        }

        // Rescan content for outgoing links (strict mode: rejects dangling/ambiguous)
        if (content.trim().length > 0) {
          await scanAndStoreLinks(client, agentId, id, content, "strict");
        } else {
          // Empty content — drop any existing outgoing links
          await client.query("DELETE FROM links WHERE source_id = $1", [id]);
        }

        return updateResult.rows[0];
      });
    } catch (err) {
      if (err instanceof Error && err.message === "NOT_FOUND") {
        return toolError("NOT_FOUND", "Entry not found or access denied");
      }
      if (err instanceof DanglingLinkError) {
        return toolError("DANGLING_LINK", err.message);
      }
      if (err instanceof AmbiguousLinkError) {
        return toolError("AMBIGUOUS_LINK", err.message);
      }
      throw err;
    }

    const response: Record<string, unknown> = {
      id: row.id,
      title: row.title,
      type: row.type,
      mime_type: row.mime_type,
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

  // Non-content update path (metadata/title/type/mime_type only)
  let row: any;
  try {
    row = await withAgent(agentId, async (client) => {
      const result = await client.query(
        `UPDATE entries SET ${setClauses.join(", ")} WHERE id = $1 RETURNING ${returningCols}`,
        values
      );
      if (result.rowCount === 0) {
        throw new Error("NOT_FOUND");
      }
      return result.rows[0];
    });
  } catch (err) {
    if (err instanceof Error && err.message === "NOT_FOUND") {
      return toolError("NOT_FOUND", "Entry not found or access denied");
    }
    throw err;
  }

  const response: Record<string, unknown> = {
    id: row.id,
    title: row.title,
    type: row.type,
    mime_type: row.mime_type,
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
  content: z.string().optional(),
  title: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
  mime_type: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  chunk_size: z.number().int().positive().optional(),
  chunk_overlap: z.number().int().min(0).optional(),
  verbose: z.boolean().optional(),
  defer_embedding: z.boolean().optional(),
};

export function registerUpdateTool(server: McpServer, agentId: string): void {
  server.tool(
    "update",
    "Update an entry's content (with re-embedding), title, type, mime_type, or metadata. Pass defer_embedding=true on autosaves to skip chunking/embedding/link-rescan; flush with a non-defer update on blur or navigate-away.",
    updateSchema,
    async (params) => {
      return handleUpdate({ agentId, ...params });
    }
  );
}
