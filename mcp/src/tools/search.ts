import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { withAgent } from "../db.js";
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
  content: Array<{ type: "text"; text: string }>;
  isError?: true;
}

function toolError(code: string, message: string): ToolResult {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: code, message }) }],
    isError: true,
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
    // Path-only mode: list entries by path prefix
    rows = await withAgent(agentId, async (client) => {
      const result = await client.query(
        `SELECT id, content, path FROM entries
         WHERE agent_id = current_setting('app.agent_id')
           AND path @> $1::text[]
         ORDER BY created_at DESC`,
        [path]
      );
      return result.rows;
    });
  } else {
    // Semantic search (with optional path scope)
    const provider = createEmbeddingProvider();
    const queryVector = await provider.embed(query!);

    rows = await withAgent(agentId, async (client) => {
      const result = await client.query(
        `SELECT * FROM match_entries($1, $2, $3, $4, $5)`,
        [
          JSON.stringify(queryVector),
          threshold,
          count,
          filter ? JSON.stringify(filter) : null,
          path ?? null,
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

  // Build response
  const results = rows.map((row: any) => {
    const base: Record<string, unknown> = {
      id: row.id,
      content: row.content,
      path: row.path ?? [],
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
        filter: z.record(z.unknown()).optional().describe("JSONB metadata filter"),
        threshold: z.number().min(0).max(1).optional().default(0.7).describe("Similarity threshold"),
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
