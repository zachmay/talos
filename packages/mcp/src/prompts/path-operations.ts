import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerPathOperationsPrompt(server: McpServer): void {
  server.prompt(
    "path-operations",
    "Learn how to organise and retrieve entries using hierarchical paths",
    () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `# Path Operations Guide

Talos entries support hierarchical paths for organisation. Paths are string arrays that form a tree structure.

## Inserting with a path

\`\`\`json
{ "tool": "insert", "arguments": { "content": "Buy groceries", "path": ["tasks", "home"] } }
\`\`\`

This creates an entry at tasks > home. You can nest as deep as needed:
\`\`\`json
{ "path": ["projects", "talos", "backend", "auth"] }
\`\`\`

## Listing entries at a path (ls-style)

Call search with only a path and no query to list all entries at that path:
\`\`\`json
{ "tool": "search", "arguments": { "path": ["tasks"] } }
\`\`\`

This returns all entries whose path starts with ["tasks"], acting like a directory listing.

## Path-scoped semantic search

Combine a query with a path to search only within a subtree:
\`\`\`json
{ "tool": "search", "arguments": { "query": "authentication flow", "path": ["projects", "talos"] } }
\`\`\`

This restricts the semantic search to entries under projects > talos, improving relevance and speed.

## Tips

- Paths are optional -- entries without paths live at the root.
- Use consistent path conventions (lowercase, kebab-case) for predictable listing.
- Path listing does not require an embedding call, so it is fast and free.`,
          },
        },
      ],
    }),
  );
}
