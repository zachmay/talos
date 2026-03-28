import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerAdvancedSearchPrompt(server: McpServer): void {
  server.prompt(
    "advanced-search",
    "Learn advanced search parameters: thresholds, counts, metadata filters, and verbose mode",
    () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `# Advanced Search Guide

The search tool accepts several optional parameters beyond the basic query.

## Similarity threshold

Control how closely results must match your query (0.0 to 1.0):
\`\`\`json
{ "tool": "search", "arguments": { "query": "deploy pipeline", "threshold": 0.9 } }
\`\`\`
- Default: 0.7 (reasonable recall)
- 0.9+: High precision, fewer but very relevant results
- 0.5: Broad recall, more results with looser matching

## Result count

Limit how many results are returned:
\`\`\`json
{ "tool": "search", "arguments": { "query": "auth", "count": 5 } }
\`\`\`
Default is 10. Use lower counts for focused queries, higher for exploration.

## Metadata filtering

Filter results by metadata fields stored on entries:
\`\`\`json
{ "tool": "search", "arguments": { "query": "bugs", "filter": { "tag": "critical", "status": "open" } } }
\`\`\`
All filter conditions are ANDed -- every field must match.

## Verbose mode

Get extra detail including similarity scores, timestamps, and matched chunk info:
\`\`\`json
{ "tool": "search", "arguments": { "query": "auth", "verbose": true } }
\`\`\`

In verbose mode each result includes:
- similarity: cosine similarity score (0-1)
- matched_chunk: the specific chunk text that matched
- created_at / updated_at timestamps
- full metadata object

## Combining parameters

All parameters can be combined:
\`\`\`json
{
  "tool": "search",
  "arguments": {
    "query": "deployment",
    "path": ["projects"],
    "threshold": 0.85,
    "count": 3,
    "filter": { "env": "production" },
    "verbose": true
  }
}
\`\`\``,
          },
        },
      ],
    }),
  );
}
