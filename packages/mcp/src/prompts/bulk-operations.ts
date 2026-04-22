import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerBulkOperationsPrompt(server: McpServer): void {
  server.prompt(
    "bulk-operations",
    "Learn patterns for batch inserts, updates, and deletes",
    () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `# Bulk Operations Guide

Talos v1 processes one entry per tool call. For bulk work, issue sequential calls.

## Batch insert

Insert multiple entries by calling the insert tool repeatedly:
\`\`\`
insert({ content: "Entry 1", path: ["notes"] })
insert({ content: "Entry 2", path: ["notes"] })
insert({ content: "Entry 3", path: ["notes"] })
\`\`\`

Each call returns the created entry's ID. Collect the IDs if you need to reference them later.

Tips for batch inserts:
- Use consistent paths to group related entries.
- Add metadata tags to make batch results easy to find later.
- Large documents are automatically chunked -- you do not need to split them yourself.

## Batch update

Update multiple entries by ID:
\`\`\`
update({ id: "uuid-1", content: "Updated content 1" })
update({ id: "uuid-2", content: "Updated content 2" })
\`\`\`

For metadata-only updates (no re-embedding needed):
\`\`\`
update({ id: "uuid-1", metadata: { status: "done" } })
\`\`\`

## Batch delete

Delete multiple entries by ID:
\`\`\`
delete({ id: "uuid-1" })
delete({ id: "uuid-2" })
\`\`\`

## Search-then-act pattern

A common bulk pattern: search for entries, then update or delete the results.
\`\`\`
results = search({ query: "old notes", path: ["archive"] })
for each result:
  delete({ id: result.id })
\`\`\`

## Performance notes

- Each insert requires an embedding API call, so large batches take proportional time.
- Metadata-only updates skip the embedding step and are fast.
- Deletes are always fast (no embedding involved).
- There is no transaction wrapping across calls -- each call is independent.`,
          },
        },
      ],
    }),
  );
}
