import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerInsertTool } from "./tools/insert.js";
import { registerSearchTool } from "./tools/search.js";
import { registerUpdateTool } from "./tools/update.js";
import { registerDeleteTool } from "./tools/delete.js";
import { registerPathOperationsPrompt } from "./prompts/path-operations.js";
import { registerAdvancedSearchPrompt } from "./prompts/advanced-search.js";
import { registerBulkOperationsPrompt } from "./prompts/bulk-operations.js";

export function createServer(agentId: string): McpServer {
  const server = new McpServer({ name: "talos-mcp", version: "1.0.0" });

  registerInsertTool(server, agentId);
  registerSearchTool(server, agentId);
  registerUpdateTool(server, agentId);
  registerDeleteTool(server, agentId);

  registerPathOperationsPrompt(server);
  registerAdvancedSearchPrompt(server);
  registerBulkOperationsPrompt(server);

  return server;
}
