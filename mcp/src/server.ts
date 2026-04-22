import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerInsertTool } from "./tools/insert.js";
import { registerSearchTool } from "./tools/search.js";
import { registerUpdateTool } from "./tools/update.js";
import { registerDeleteTool } from "./tools/delete.js";
import { registerFetchTool } from "./tools/fetch.js";
import { registerGetTool } from "./tools/get.js";
import { registerListChildrenTool } from "./tools/list_children.js";
import { registerBacklinksTool } from "./tools/backlinks.js";
import { registerRecentTool } from "./tools/recent.js";
import { registerSearchTitlesTool } from "./tools/search_titles.js";
import { registerPathOperationsPrompt } from "./prompts/path-operations.js";
import { registerAdvancedSearchPrompt } from "./prompts/advanced-search.js";
import { registerBulkOperationsPrompt } from "./prompts/bulk-operations.js";

export function createServer(agentId: string): McpServer {
  const server = new McpServer({
    name: "talos-mcp",
    version: "1.0.0",
    instructions: `Talos MCP provides semantic memory backed by PostgreSQL + pgvector.

Tools: insert, search, update, delete, fetch, get, list_children, backlinks, recent, search_titles.

Search uses cosine similarity with a threshold (default 0.7). If a search returns no results:
- Try lowering the threshold (e.g. 0.3 or 0.4) for broader matching
- Try rephrasing the query — shorter, more keyword-focused queries often match better
- Use path-only search to list entries without semantic matching
- Use verbose: true to see similarity scores and debug matching

Data is organized by path (array of strings) and optional metadata (JSON). Use paths to scope searches to specific topics or categories.`,
  });

  registerInsertTool(server, agentId);
  registerSearchTool(server, agentId);
  registerUpdateTool(server, agentId);
  registerDeleteTool(server, agentId);
  registerFetchTool(server);
  registerGetTool(server, agentId);
  registerListChildrenTool(server, agentId);
  registerBacklinksTool(server, agentId);
  registerRecentTool(server, agentId);
  registerSearchTitlesTool(server, agentId);

  registerPathOperationsPrompt(server);
  registerAdvancedSearchPrompt(server);
  registerBulkOperationsPrompt(server);

  return server;
}
