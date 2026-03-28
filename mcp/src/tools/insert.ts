import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { withAgent } from "../db.js";
import { withAudit } from "../audit.js";
import { createEmbeddingProvider } from "../providers/interface.js";
import { chunkText } from "../chunker.js";

const MAX_CONTENT_LENGTH = 50_000;

interface InsertInput {
  content: string;
  path?: string[];
  metadata?: Record<string, unknown>;
  chunk_size?: number;
  chunk_overlap?: number;
  verbose?: boolean;
}

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

export async function _handleInsert(input: InsertInput, agentId: string): Promise<ToolResult> {
  const { content, path, metadata, chunk_size, chunk_overlap, verbose } = input;

  // Validation
  if (!content || content.trim().length === 0) {
    return toolError("VALIDATION_ERROR", "Content must not be empty");
  }
  if (content.length > MAX_CONTENT_LENGTH) {
    return toolError("VALIDATION_ERROR", "Content exceeds maximum length");
  }

  // Chunk config
  const chunkSize = chunk_size ?? parseInt(process.env.CHUNK_SIZE ?? "2000", 10);
  const chunkOverlap = chunk_overlap ?? parseInt(process.env.CHUNK_OVERLAP ?? "200", 10);

  // Embed
  const provider = createEmbeddingProvider();
  const chunks = chunkText(content, chunkSize, chunkOverlap);

  let vectors: number[][];
  try {
    vectors = await Promise.all(chunks.map((c) => provider.embed(c)));
  } catch (err: any) {
    return toolError("EMBEDDING_FAILED", err.message);
  }

  // Write atomically
  const startMs = Date.now();
  const row = await withAgent(agentId, async (client) => {
    // Insert entry first to get ID for audit trail
    const entryResult = await client.query(
      `INSERT INTO entries (agent_id, content, path, metadata)
       VALUES (current_setting('app.agent_id'), $1, $2, $3)
       RETURNING id, content, path, metadata, created_at`,
      [content, path ?? [], metadata ? JSON.stringify(metadata) : '{}']
    );
    const entry = entryResult.rows[0];

    // Wrap chunk inserts + audit in withAudit (same transaction)
    await withAudit(client, agentId, "insert", entry.id, {}, async () => {
      if (chunks.length > 0) {
        const values: any[] = [];
        const placeholders: string[] = [];
        chunks.forEach((_, i) => {
          const offset = i * 5;
          placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`);
          values.push(entry.id, i, chunks[i], JSON.stringify(vectors[i]), agentId);
        });
        await client.query(
          `INSERT INTO chunks (entry_id, chunk_idx, chunk_text, embedding, agent_id) VALUES ${placeholders.join(", ")}`,
          values
        );
      }
      return null;
    });

    return entry;
  });

  const durationMs = Date.now() - startMs;

  // Structured log
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "info",
    operation: "insert",
    agent_id: agentId,
    entry_id: row.id,
    chunks: chunks.length,
    duration_ms: durationMs,
  }));

  // Build response
  const result: Record<string, unknown> = {
    id: row.id,
    content: row.content,
    path: row.path ?? [],
  };

  if (verbose) {
    result.metadata = row.metadata;
    result.created_at = row.created_at;
    result.chunk_count = chunks.length;
  }

  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
  };
}

export function registerInsertTool(server: McpServer, agentId: string): void {
  server.registerTool(
    "insert",
    {
      description: "Insert text content into semantic memory with automatic embedding and chunking",
      inputSchema: {
        content: z.string().min(1, "Content must not be empty").max(MAX_CONTENT_LENGTH),
        path: z.array(z.string()).optional().describe("Path hierarchy e.g. ['tasks', 'home']"),
        metadata: z.record(z.unknown()).optional().describe("Arbitrary metadata JSONB"),
        chunk_size: z.number().int().positive().optional().describe("Override default chunk size in chars"),
        chunk_overlap: z.number().int().min(0).optional().describe("Override default chunk overlap in chars"),
        verbose: z.boolean().optional().describe("Return full metadata in response"),
      },
    },
    async (input) => {
      return _handleInsert(input as InsertInput, agentId);
    }
  );
}
