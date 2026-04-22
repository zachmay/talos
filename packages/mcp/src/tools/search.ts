import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { withAgent } from "../db.js";
import { computeEtag } from "../etag.js";
import { createEmbeddingProvider } from "../providers/interface.js";

interface SearchInput {
  query?: string;
  path?: string[];
  filter?: Record<string, unknown>;
  threshold?: number;
  count?: number;
  depth?: number;
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

// System columns that are filtered directly, not via metadata @> containment.
const COLUMN_FILTERS = new Set(["title", "type", "mime_type"]);

function splitFilter(filter: Record<string, unknown> | undefined): {
  title: string | null;
  type: string | null;
  mime_type: string | null;
  metadata: Record<string, unknown> | null;
} {
  if (!filter) {
    return { title: null, type: null, mime_type: null, metadata: null };
  }
  const metadata: Record<string, unknown> = {};
  let title: string | null = null;
  let type: string | null = null;
  let mime_type: string | null = null;
  for (const [k, v] of Object.entries(filter)) {
    if (k === "title") title = typeof v === "string" ? v : String(v);
    else if (k === "type") type = typeof v === "string" ? v : String(v);
    else if (k === "mime_type") mime_type = typeof v === "string" ? v : String(v);
    else metadata[k] = v;
  }
  return {
    title,
    type,
    mime_type,
    metadata: Object.keys(metadata).length > 0 ? metadata : null,
  };
}

export async function _handleSearch(input: SearchInput, agentId: string): Promise<ToolResult> {
  const { query, path, filter, threshold = 0.7, count = 10, verbose } = input;

  if (!query && !path) {
    return toolError("VALIDATION_ERROR", "Provide query and/or path");
  }

  const startMs = Date.now();
  let rows: any[];

  if (!query && path) {
    // Path-only mode: list entries by path prefix (optionally filtered by columns/metadata)
    const { title, type, mime_type, metadata } = splitFilter(filter);
    rows = await withAgent(agentId, async (client) => {
      const conditions: string[] = ["path @> $1::text[]"];
      const values: any[] = [path];
      let p = 2;
      if (title !== null) { conditions.push(`title = $${p++}`); values.push(title); }
      if (type !== null) { conditions.push(`type = $${p++}`); values.push(type); }
      if (mime_type !== null) { conditions.push(`mime_type = $${p++}`); values.push(mime_type); }
      if (metadata !== null) { conditions.push(`metadata @> $${p++}::jsonb`); values.push(JSON.stringify(metadata)); }
      const result = await client.query(
        `SELECT id, title, type, mime_type, content, path, metadata, created_at
         FROM entries
         WHERE ${conditions.join(" AND ")}
         ORDER BY created_at DESC`,
        values
      );
      return result.rows;
    });
  } else {
    // Semantic search (with optional path + column + metadata filters)
    const provider = createEmbeddingProvider();
    const queryVector = await provider.embed(query!);
    const { title, type, mime_type, metadata } = splitFilter(filter);

    rows = await withAgent(agentId, async (client) => {
      const result = await client.query(
        `SELECT * FROM match_entries($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          JSON.stringify(queryVector),
          threshold,
          count,
          metadata ? JSON.stringify(metadata) : null,
          path ?? null,
          title,
          type,
          mime_type,
        ]
      );
      return result.rows;
    });
  }

  const durationMs = Date.now() - startMs;

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "info",
    operation: "search",
    agent_id: agentId,
    query_present: !!query,
    result_count: rows.length,
    duration_ms: durationMs,
  }));

  // Build response — etag is always included so clients can chain updates
  // without a separate get round-trip.
  const results = rows.map((row: any) => {
    const etag = computeEtag({
      title: row.title,
      path: row.path,
      content: row.content,
      metadata: row.metadata,
    });
    const base: Record<string, unknown> = {
      id: row.id,
      title: row.title,
      type: row.type,
      mime_type: row.mime_type,
      content: row.content,
      path: row.path ?? [],
      etag,
    };

    if (verbose) {
      base.similarity = row.similarity;
      base.metadata = row.metadata;
      base.created_at = row.created_at;
      base.matched_chunk = row.matched_chunk;
    }

    return base;
  });

  return {
    content: [{ type: "text" as const, text: JSON.stringify(results) }],
  };
}

export function registerSearchTool(server: McpServer, agentId: string): void {
  server.registerTool(
    "search",
    {
      description: "Search semantic memory by query text and/or path. Path-only acts as listing.",
      inputSchema: {
        query: z.string().optional().describe("Semantic search query text"),
        path: z.array(z.string()).optional().describe("Filter by path prefix"),
        filter: z.record(z.unknown()).optional().describe("Filter by title/type/mime_type (direct) or any other key (metadata containment)"),
        threshold: z.number().min(0).max(1).optional().default(0.7).describe("Cosine similarity threshold (0-1). Default 0.7."),
        count: z.number().int().positive().optional().default(10).describe("Max results"),
        depth: z.number().int().positive().optional().describe("Path depth limit"),
        verbose: z.boolean().optional().describe("Include similarity, metadata, timestamps"),
      },
    },
    async (input) => {
      return _handleSearch(input as SearchInput, agentId);
    }
  );
}
