import fs from "node:fs";
import type Anthropic from "@anthropic-ai/sdk";
import { runClaudeLoop } from "./providers/claude.js";
export type { LoopResult } from "./providers/claude.js";

function loadMcpApiKey(): string {
  try {
    const raw = fs.readFileSync("/run/secrets/agent_keys", "utf8");
    const keys = JSON.parse(raw);
    return Object.keys(keys)[0] ?? "";
  } catch {
    return "";
  }
}

/**
 * Provider-agnostic agentic loop dispatcher.
 * Reads AGENT_LLM_PROVIDER env var to select the provider.
 */
export async function startAgentLoop(
  systemPrompt: string,
  userInput: string,
  conversationHistory: Anthropic.MessageParam[]
): Promise<import("./providers/claude.js").LoopResult> {
  const provider = process.env.AGENT_LLM_PROVIDER ?? "claude";
  const mcpUrl = process.env.MCP_SERVER_URL ?? "http://mcp:3000/mcp";
  const apiKey = loadMcpApiKey();

  if (provider === "claude") {
    return runClaudeLoop(systemPrompt, userInput, mcpUrl, apiKey, conversationHistory);
  }
  return { text: `[error]: Provider '${provider}' not yet implemented. Set AGENT_LLM_PROVIDER=claude.`, inputTokens: 0, outputTokens: 0, contextLimit: 0, turns: 0 };
}
