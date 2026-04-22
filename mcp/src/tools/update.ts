import { z } from "zod";
import { withAgent } from "../db.js";

import { chunkText } from "../chunker.js";
import { findCollisions } from "../collisions.js";
import { computeEtag } from "../etag.js";
import { createEmbeddingProvider } from "../providers/interface.js";
import { scanAndStoreLinks, DanglingLinkError, AmbiguousLinkError } from "../links.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: true;
}

function toolError(code: string, message: string, extra?: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: code, message, ...(extra ?? {}) }) }],
    isError: true,
  };
}

interface UpdateParams {
  agentId: string;
  id: string;
  // if_match is the etag the client most recently read for this entry.
  // The server recomputes the current etag inside the update transaction;
  // on mismatch we abort with PRECONDITION_FAILED so the caller can decide
  // whether to reload or force-write with a fresh etag. Required — there is
  // no bypass, since any blind update risks clobbering a concurrent edit.
  if_match: string;
  content?: string;
  title?: string;
  type?: string;
  mime_type?: string;
  path?: string[];
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
  // When true, skip the (path, title) collision check. See UpdateParams.
  allow_collision?: boolean;
}

// Raised inside the update transaction when a path/title change would
// produce a (path, title) pair already used by some other entry. Bubbled
// out of each path-specific try/catch so we can respond with COLLISION +
// conflicting ids.
class UpdateCollisionError extends Error {
  constructor(public conflicts: string[]) {
    super("COLLISION");
    this.name = "UpdateCollisionError";
  }
}

// Called inside the update transaction after the if_match check. Only
// rejects when the update would NEWLY create a collision — edits that leave
// (path, title) unchanged never trigger, and an existing duplicate that
// predates the write doesn't count against an in-place update.
async function checkCollision(
  client: import("pg").PoolClient,
  id: string,
  newPath: string[] | null,
  newTitle: string | null,
): Promise<void> {
  // Fetch the current (path, title) so we can determine whether this update
  // actually changes the pair, and what the post-update pair would be.
  const currentResult = await client.query(
    "SELECT path, title FROM entries WHERE id = $1",
    [id],
  );
  if (currentResult.rowCount === 0) return;
  const current = currentResult.rows[0];
  const effectivePath = newPath ?? current.path ?? [];
  const effectiveTitle = newTitle ?? current.title;
  // No-op if neither changed.
  const pathChanged = newPath !== null && JSON.stringify(newPath) !== JSON.stringify(current.path);
  const titleChanged = newTitle !== null && newTitle !== current.title;
  if (!pathChanged && !titleChanged) return;
  const conflicts = await findCollisions(client, effectivePath, effectiveTitle, id);
  if (conflicts.length > 0) throw new UpdateCollisionError(conflicts);
}

// Helper: fetches a row by id, computes its current etag, and returns both.
// Raises NOT_FOUND / PRECONDITION_FAILED as appropriate.
async function checkIfMatch(
  client: import("pg").PoolClient,
  id: string,
  ifMatch: string,
): Promise<void> {
  const result = await client.query(
    "SELECT title, path, content, metadata FROM entries WHERE id = $1",
    [id],
  );
  if (result.rowCount === 0) throw new Error("NOT_FOUND");
  const row = result.rows[0];
  const current = computeEtag({
    title: row.title,
    path: row.path,
    content: row.content,
    metadata: row.metadata,
  });
  if (current !== ifMatch) throw new Error("PRECONDITION_FAILED");
}

export async function handleUpdate(params: UpdateParams): Promise<ToolResult> {
  const { agentId, id, if_match, content, title, type, mime_type, path, metadata, verbose, defer_embedding, allow_collision } = params;

  // Validate: at least one updatable field
  if (
    content === undefined &&
    title === undefined &&
    type === undefined &&
    mime_type === undefined &&
    path === undefined &&
    metadata === undefined
  ) {
    return toolError(
      "VALIDATION_ERROR",
      "At least one of content, title, type, mime_type, path, or metadata must be provided"
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
  if (path !== undefined) { setClauses.push(`path = $${p++}::text[]`); values.push(path); }
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
        await checkIfMatch(client, id, if_match);
        if (!allow_collision) {
          await checkCollision(client, id, path ?? null, title ?? null);
        }
        const result = await client.query(
          `UPDATE entries SET ${setClauses.join(", ")} WHERE id = $1 RETURNING ${returningCols}, content, metadata, path`,
          values
        );
        if (result.rowCount === 0) throw new Error("NOT_FOUND");
        return result.rows[0];
      });
    } catch (err) {
      if (err instanceof Error && err.message === "NOT_FOUND") {
        return toolError("NOT_FOUND", "Entry not found or access denied");
      }
      if (err instanceof Error && err.message === "PRECONDITION_FAILED") {
        return toolError("PRECONDITION_FAILED", "if_match does not match current etag");
      }
      if (err instanceof UpdateCollisionError) {
        return toolError(
          "COLLISION",
          "another entry already exists at the target (path, title)",
          { conflicts: err.conflicts },
        );
      }
      throw err;
    }
    const etag = computeEtag({
      title: row.title,
      path: row.path,
      content: row.content,
      metadata: row.metadata,
    });
    const response: Record<string, unknown> = {
      id: row.id,
      title: row.title,
      type: row.type,
      mime_type: row.mime_type,
      content: row.content,
      path: row.path,
      deferred: true,
      etag,
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
        await checkIfMatch(client, id, if_match);
        if (!allow_collision) {
          await checkCollision(client, id, path ?? null, title ?? null);
        }
        await client.query("DELETE FROM chunks WHERE entry_id = $1", [id]);

        const updateResult = await client.query(
          `UPDATE entries SET ${setClauses.join(", ")} WHERE id = $1 RETURNING ${returningCols}, content, metadata, path`,
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
      if (err instanceof Error && err.message === "PRECONDITION_FAILED") {
        return toolError("PRECONDITION_FAILED", "if_match does not match current etag");
      }
      if (err instanceof UpdateCollisionError) {
        return toolError(
          "COLLISION",
          "another entry already exists at the target (path, title)",
          { conflicts: err.conflicts },
        );
      }
      if (err instanceof DanglingLinkError) {
        return toolError("DANGLING_LINK", err.message);
      }
      if (err instanceof AmbiguousLinkError) {
        return toolError("AMBIGUOUS_LINK", err.message);
      }
      throw err;
    }

    const etag = computeEtag({
      title: row.title,
      path: row.path,
      content: row.content,
      metadata: row.metadata,
    });
    const response: Record<string, unknown> = {
      id: row.id,
      title: row.title,
      type: row.type,
      mime_type: row.mime_type,
      content: row.content,
      path: row.path,
      etag,
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

  // Non-content update path (metadata/title/type/mime_type/path only)
  let row: any;
  try {
    row = await withAgent(agentId, async (client) => {
      await checkIfMatch(client, id, if_match);
      if (!allow_collision) {
        await checkCollision(client, id, path ?? null, title ?? null);
      }
      const result = await client.query(
        `UPDATE entries SET ${setClauses.join(", ")} WHERE id = $1 RETURNING ${returningCols}, content, metadata, path`,
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
    if (err instanceof Error && err.message === "PRECONDITION_FAILED") {
      return toolError("PRECONDITION_FAILED", "if_match does not match current etag");
    }
    if (err instanceof UpdateCollisionError) {
      return toolError(
        "COLLISION",
        "another entry already exists at the target (path, title)",
        { conflicts: err.conflicts },
      );
    }
    throw err;
  }

  const etag = computeEtag({
    title: row.title,
    path: row.path,
    content: row.content,
    metadata: row.metadata,
  });
  const response: Record<string, unknown> = {
    id: row.id,
    title: row.title,
    type: row.type,
    mime_type: row.mime_type,
    content: row.content,
    path: row.path,
    etag,
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
  if_match: z.string().min(1, "if_match is required — pass the etag returned by get/search/update"),
  content: z.string().optional(),
  title: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
  mime_type: z.string().optional(),
  path: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
  chunk_size: z.number().int().positive().optional(),
  chunk_overlap: z.number().int().min(0).optional(),
  verbose: z.boolean().optional(),
  defer_embedding: z.boolean().optional(),
  allow_collision: z.boolean().optional(),
};

export function registerUpdateTool(server: McpServer, agentId: string): void {
  server.tool(
    "update",
    "Update an entry. Requires if_match (etag from the most recent get/search/update); on mismatch returns PRECONDITION_FAILED. Changing path and/or title runs a (path, title) collision check; pass allow_collision=true to bypass (intended for bulk imports). Pass defer_embedding=true on autosaves to skip chunking/embedding/link-rescan; flush with a non-defer update on blur or navigate-away.",
    updateSchema,
    async (params) => {
      return handleUpdate({ agentId, ...params });
    }
  );
}
