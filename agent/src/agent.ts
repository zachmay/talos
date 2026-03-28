import { runClaudeLoop } from "./providers/claude.js";

/**
 * Provider-agnostic agentic loop dispatcher.
 * Reads AGENT_LLM_PROVIDER env var to select the provider.
 */
export async function startAgentLoop(
  systemPrompt: string,
  userInput: string
): Promise<string> {
  const provider = process.env.AGENT_LLM_PROVIDER ?? "claude";
  const mcpUrl = process.env.MCP_SERVER_URL ?? "http://mcp:3000/mcp";
  const apiKey = process.env.AGENT_API_KEY ?? "";

  if (provider === "claude") {
    return runClaudeLoop(systemPrompt, userInput, mcpUrl, apiKey);
  }
  return `[error]: Provider '${provider}' not yet implemented. Set AGENT_LLM_PROVIDER=claude.`;
}
