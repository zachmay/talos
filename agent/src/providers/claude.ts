import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { AgentEvent } from "../../../shared/types.js";

const MAX_TURNS = 50;
// Context limits by model family (input tokens)
const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  "claude-opus-4-6": 200_000,
  "claude-sonnet-4-6": 200_000,
  "claude-haiku-4-5-20251001": 200_000,
};
const DEFAULT_CONTEXT_LIMIT = 200_000;
const COMPRESS_THRESHOLD = 0.8; // compress at 80% of context limit

export interface LoopResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  contextLimit: number;
  turns: number;
}

interface McpToolDef {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

function loadApiKey(): string {
  try {
    return fs.readFileSync("/run/secrets/agent_llm_key", "utf8").trim();
  } catch {
    return "";
  }
}

async function connectMcp(mcpServerUrl: string, apiKey: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(mcpServerUrl), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    },
  });
  const client = new Client({ name: "talos-agent", version: "0.1.0" });
  await client.connect(transport);
  return client;
}

async function listMcpTools(mcp: Client): Promise<McpToolDef[]> {
  const result = await mcp.listTools();
  return result.tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema as Record<string, unknown>,
  }));
}

async function callMcpTool(
  mcp: Client,
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const result = await mcp.callTool({ name, arguments: args });
  const parts = (result.content as Array<{ type: string; text?: string }>)
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text!);
  return parts.join("\n") || JSON.stringify(result.content);
}

async function compressHistory(
  anthropic: Anthropic,
  history: Anthropic.MessageParam[],
  model: string
): Promise<void> {
  // Take the first half of history for summarization, keep recent turns intact
  const splitPoint = Math.floor(history.length / 2);
  if (splitPoint < 2) return; // not enough to compress

  const oldMessages = history.slice(0, splitPoint);

  // Extract text content from old messages for summarization
  const transcript = oldMessages.map((msg) => {
    const content = typeof msg.content === "string"
      ? msg.content
      : (msg.content as Array<{ type: string; text?: string }>)
          .filter((b) => b.type === "text" && b.text)
          .map((b) => b.text)
          .join("");
    return `${msg.role}: ${content}`;
  }).filter((line) => line.length > 6).join("\n");

  if (!transcript.trim()) return;

  const summaryResponse = await anthropic.messages.create({
    model,
    max_tokens: 2048,
    system: "Summarize this conversation excerpt concisely. Preserve: key decisions, current task state, important facts learned, and any commitments made. Omit pleasantries and redundant detail.",
    messages: [{ role: "user", content: transcript }],
  });

  const summary = summaryResponse.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  // Replace old messages with summary, keep recent messages
  const recentMessages = history.slice(splitPoint);
  history.length = 0;
  history.push(
    { role: "user", content: `[Prior conversation summary]: ${summary}` },
    { role: "assistant", content: "Understood, I have the context from our previous conversation. Let's continue." },
    ...recentMessages
  );

  process.stderr.write(`[context] Compressed ${splitPoint} messages into summary. ${history.length} messages remain.\n`);
}

/**
 * Streaming agentic loop using local MCP client. Yields AgentEvent objects
 * as the Claude stream progresses — thinking deltas, token deltas, tool
 * calls, and a final done/error event.
 */
export async function* streamClaudeLoop(
  systemPrompt: string,
  userInput: string,
  mcpServerUrl: string,
  agentApiKey: string,
  conversationHistory: Anthropic.MessageParam[]
): AsyncGenerator<AgentEvent> {
  const apiKey = loadApiKey();
  if (!apiKey) {
    yield { type: "error", message: "[error]: No API key found. Mount agent_llm_key secret." };
    return;
  }

  const anthropic = new Anthropic({ apiKey });
  const model = process.env.AGENT_LLM_MODEL ?? "claude-sonnet-4-6";
  const contextLimit = MODEL_CONTEXT_LIMITS[model] ?? DEFAULT_CONTEXT_LIMIT;
  let lastInputTokens = 0;
  let totalOutputTokens = 0;
  let turnCount = 0;

  // Connect to MCP and discover tools
  let mcp: Client;
  let mcpTools: McpToolDef[];
  try {
    mcp = await connectMcp(mcpServerUrl, agentApiKey);
    mcpTools = await listMcpTools(mcp);
    process.stderr.write(`[mcp] Connected. ${mcpTools.length} tools available.\n`);
  } catch (err) {
    yield { type: "error", message: `[error]: Failed to connect to MCP server at ${mcpServerUrl}: ${err}` };
    return;
  }

  // Convert MCP tools to Anthropic tool format
  const tools: Anthropic.Tool[] = mcpTools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
  }));

  // Append user message to shared conversation history
  conversationHistory.push({ role: "user", content: userInput });

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const stream = anthropic.messages.stream({
        model,
        max_tokens: parseInt(process.env.AGENT_MAX_TOKENS ?? "16384", 10),
        system: systemPrompt,
        messages: conversationHistory,
        tools: tools.length > 0 ? tools : undefined,
      });

      // Yield streaming events as they arrive
      for await (const event of stream) {
        if (event.type === "content_block_delta") {
          const delta = event.delta as { type: string; text?: string; thinking?: string };
          if (delta.type === "text_delta" && delta.text) {
            yield { type: "token", text: delta.text };
          } else if (delta.type === "thinking_delta" && delta.thinking) {
            yield { type: "thinking", text: delta.thinking };
          }
        }
      }

      // Get the final message with usage stats
      const response = await stream.finalMessage();

      conversationHistory.push({ role: "assistant", content: response.content });

      lastInputTokens = response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;
      turnCount++;

      if (response.usage.input_tokens > contextLimit * COMPRESS_THRESHOLD) {
        process.stderr.write(
          `[context] ${response.usage.input_tokens}/${contextLimit} tokens used (${Math.round(response.usage.input_tokens / contextLimit * 100)}%). Compressing...\n`
        );
        await compressHistory(anthropic, conversationHistory, model);
      }

      if (response.stop_reason === "end_turn") {
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("");
        yield { type: "done", result: { text, inputTokens: lastInputTokens, outputTokens: totalOutputTokens, contextLimit, turns: turnCount } };
        return;
      }

      if (response.stop_reason === "max_tokens") {
        conversationHistory.push({ role: "user", content: "Continue from where you left off." });
        continue;
      }

      if (response.stop_reason === "tool_use") {
        const toolUseBlocks = response.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
        );

        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of toolUseBlocks) {
          yield { type: "tool_start", name: block.name, input: block.input as Record<string, unknown> };
          try {
            const result = await callMcpTool(mcp, block.name, block.input as Record<string, unknown>);
            toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
            yield { type: "tool_result", name: block.name, result };
          } catch (err) {
            const errStr = `[error]: ${err}`;
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: errStr,
              is_error: true,
            });
            yield { type: "tool_result", name: block.name, result: errStr };
          }
        }

        conversationHistory.push({ role: "user", content: toolResults });
        continue;
      }

      process.stderr.write(`[warn] Unexpected stop_reason: ${response.stop_reason}, ending loop.\n`);
      const fallbackText = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      yield { type: "done", result: { text: fallbackText || "[error]: Agent loop ended unexpectedly.", inputTokens: lastInputTokens, outputTokens: totalOutputTokens, contextLimit, turns: turnCount } };
      return;
    }

    yield { type: "done", result: { text: "[error]: Agent loop exceeded maximum turns (50).", inputTokens: lastInputTokens, outputTokens: totalOutputTokens, contextLimit, turns: turnCount } };
  } catch (err) {
    yield { type: "error", message: String(err) };
  } finally {
    await mcp.close().catch(() => {});
  }
}

/**
 * Backward-compatible wrapper: collects streaming events and returns LoopResult.
 * Used by the readline (non-streaming) path.
 */
export async function runClaudeLoop(
  systemPrompt: string,
  userInput: string,
  mcpServerUrl: string,
  agentApiKey: string,
  conversationHistory: Anthropic.MessageParam[]
): Promise<LoopResult> {
  let result: LoopResult = { text: "", inputTokens: 0, outputTokens: 0, contextLimit: 0, turns: 0 };
  for await (const event of streamClaudeLoop(systemPrompt, userInput, mcpServerUrl, agentApiKey, conversationHistory)) {
    if (event.type === "done") result = event.result;
    if (event.type === "error") throw new Error(event.message);
  }
  return result;
}
