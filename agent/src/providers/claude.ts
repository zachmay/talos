import Anthropic from "@anthropic-ai/sdk";

const MAX_TURNS = 50;

/**
 * Agentic loop using Anthropic SDK MCP connector beta.
 * The connector handles MCP tool calls server-side.
 *
 * NOTE: The MCP connector may require HTTPS URLs. If mcpServerUrl starts with
 * http://, the connector may reject it with a 400 validation error. If this
 * occurs at runtime, switch to @modelcontextprotocol/sdk StreamableHttpClientTransport.
 */
export async function runClaudeLoop(
  systemPrompt: string,
  userInput: string,
  mcpServerUrl: string,
  agentApiKey: string
): Promise<string> {
  const anthropic = new Anthropic({
    apiKey: process.env.AGENT_LLM_API_KEY,
  });

  if (mcpServerUrl.startsWith("http://")) {
    process.stderr.write(
      `[warn] MCP server URL is HTTP (${mcpServerUrl}). The Anthropic MCP connector may require HTTPS.\n`
    );
  }

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userInput },
  ];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await (anthropic.beta.messages.create as Function)({
      model: process.env.AGENT_LLM_MODEL ?? "claude-sonnet-4-6",
      max_tokens: 8192,
      system: systemPrompt,
      messages,
      mcp_servers: [
        {
          type: "url",
          url: mcpServerUrl,
          name: "talos-mcp",
          authorization_token: agentApiKey,
        },
      ],
      tools: [{ type: "mcp_toolset", mcp_server_name: "talos-mcp" }],
      betas: ["mcp-client-2025-11-20"],
    });

    // Push assistant response to conversation
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn") {
      // Extract text blocks and return
      const text = response.content
        .filter((b: { type: string }) => b.type === "text")
        .map((b: { type: string; text: string }) => b.text)
        .join("");
      return text;
    }

    if (response.stop_reason === "max_tokens") {
      const text = response.content
        .filter((b: { type: string }) => b.type === "text")
        .map((b: { type: string; text: string }) => b.text)
        .join("");
      return text + "\n[warn]: max_tokens reached";
    }

    // For tool_use: construct tool_result blocks BEFORE any text (Pitfall 5)
    const toolUseBlocks = response.content.filter(
      (b: { type: string }) => b.type === "tool_use"
    );

    if (toolUseBlocks.length > 0) {
      // MCP connector handles tool execution server-side
      // The next API call will automatically include tool results
      // We just need to continue the loop
      continue;
    }

    // Unknown stop reason - break to avoid infinite loop
    process.stderr.write(
      `[warn] Unexpected stop_reason: ${response.stop_reason}, ending loop.\n`
    );
    const fallbackText = response.content
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { type: string; text: string }) => b.text)
      .join("");
    return fallbackText || "[error]: Agent loop ended unexpectedly.";
  }

  return "[error]: Agent loop exceeded maximum turns (50).";
}
