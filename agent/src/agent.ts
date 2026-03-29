import fs from "node:fs";
import type Anthropic from "@anthropic-ai/sdk";
import { runClaudeLoop, streamClaudeLoop } from "./providers/claude.js";
import type { AgentEvent } from "../../shared/types.js";
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
 *
 * When onEvent is provided, streams AgentEvent objects to the callback
 * (used by the HTTP server for SSE). When omitted, falls back to the
 * batch runClaudeLoop wrapper (readline path).
 */
export async function startAgentLoop(
  systemPrompt: string,
  userInput: string,
  conversationHistory: Anthropic.MessageParam[],
  onEvent?: (event: AgentEvent) => void
): Promise<import("./providers/claude.js").LoopResult> {
  const provider = process.env.AGENT_LLM_PROVIDER ?? "claude";
  const mcpUrl = process.env.MCP_SERVER_URL ?? "http://mcp:3000/mcp";
  const apiKey = loadMcpApiKey();

  if (provider !== "claude") {
    return { text: `[error]: Provider '${provider}' not yet implemented. Set AGENT_LLM_PROVIDER=claude.`, inputTokens: 0, outputTokens: 0, contextLimit: 0, turns: 0 };
  }

  if (onEvent) {
    // Streaming path: yield events to callback
    let result: import("./providers/claude.js").LoopResult = { text: "", inputTokens: 0, outputTokens: 0, contextLimit: 0, turns: 0 };
    for await (const event of streamClaudeLoop(systemPrompt, userInput, mcpUrl, apiKey, conversationHistory)) {
      onEvent(event);
      if (event.type === "done") result = event.result;
      if (event.type === "error") throw new Error(event.message);
    }
    return result;
  }

  // Batch path: collect full response (readline)
  return runClaudeLoop(systemPrompt, userInput, mcpUrl, apiKey, conversationHistory);
}
