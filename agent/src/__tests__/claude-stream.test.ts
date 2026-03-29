/**
 * Tests for streamClaudeLoop AsyncGenerator and runClaudeLoop wrapper.
 * Uses jest.unstable_mockModule for ESM compatibility.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

import type { AgentEvent } from "../../../shared/types.js";

// Helper: create a mock MessageStream that yields events and has finalMessage()
function createMockStream(
  events: Array<{ type: string; [key: string]: unknown }>,
  finalMsg: {
    content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown; thinking?: string; signature?: string }>;
    stop_reason: string;
    usage: { input_tokens: number; output_tokens: number };
  }
) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const ev of events) yield ev;
    },
    finalMessage: jest.fn<() => Promise<typeof finalMsg>>().mockResolvedValue(finalMsg),
  };
}

// Shared mock references
let mockAnthropicConstructor: jest.Mock;
let mockClientConstructor: jest.Mock;
let mockClientInstance: {
  connect: jest.Mock<any>;
  listTools: jest.Mock<any>;
  callTool: jest.Mock<any>;
  close: jest.Mock<any>;
};

jest.unstable_mockModule("node:fs", () => ({
  default: { readFileSync: jest.fn().mockReturnValue("test-api-key") },
}));

jest.unstable_mockModule("@anthropic-ai/sdk", () => {
  mockAnthropicConstructor = jest.fn();
  return { default: mockAnthropicConstructor };
});

jest.unstable_mockModule("@modelcontextprotocol/sdk/client/index.js", () => {
  mockClientInstance = {
    connect: jest.fn<any>().mockResolvedValue(undefined),
    listTools: jest.fn<any>().mockResolvedValue({ tools: [] }),
    callTool: jest.fn<any>().mockResolvedValue({ content: [{ type: "text", text: "tool-result" }] }),
    close: jest.fn<any>().mockResolvedValue(undefined),
  };
  mockClientConstructor = jest.fn().mockImplementation(() => mockClientInstance);
  return { Client: mockClientConstructor };
});

jest.unstable_mockModule("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: jest.fn(),
}));

// Dynamic import after mocks
const { streamClaudeLoop, runClaudeLoop } = await import("../providers/claude.js");

async function collectEvents(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const ev of gen) events.push(ev);
  return events;
}

describe("streamClaudeLoop", () => {
  it("yields token events for text deltas and done event", async () => {
    const stream = createMockStream(
      [
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " world" } },
      ],
      {
        content: [{ type: "text", text: "Hello world" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 100, output_tokens: 50 },
      }
    );

    mockAnthropicConstructor.mockImplementation(() => ({
      messages: { stream: jest.fn().mockReturnValue(stream) },
    }));

    const events = await collectEvents(
      streamClaudeLoop("system", "hi", "http://mcp:3000/mcp", "key", [])
    );

    expect(events.filter((e) => e.type === "token")).toHaveLength(2);
    expect(events.find((e) => e.type === "token")).toEqual({ type: "token", text: "Hello" });

    const done = events.find((e) => e.type === "done");
    expect(done).toBeDefined();
    if (done?.type === "done") {
      expect(done.result.turns).toBe(1);
      expect(done.result.inputTokens).toBe(100);
    }
  });

  it("yields thinking events for thinking deltas", async () => {
    const stream = createMockStream(
      [
        { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Let me think..." } },
        { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Answer" } },
      ],
      {
        content: [
          { type: "thinking", thinking: "Let me think...", signature: "sig" },
          { type: "text", text: "Answer" },
        ],
        stop_reason: "end_turn",
        usage: { input_tokens: 200, output_tokens: 100 },
      }
    );

    mockAnthropicConstructor.mockImplementation(() => ({
      messages: { stream: jest.fn().mockReturnValue(stream) },
    }));

    const events = await collectEvents(
      streamClaudeLoop("system", "hi", "http://mcp:3000/mcp", "key", [])
    );

    const thinking = events.filter((e) => e.type === "thinking");
    expect(thinking).toHaveLength(1);
    expect(thinking[0]).toEqual({ type: "thinking", text: "Let me think..." });
  });

  it("yields tool_start and tool_result for tool use", async () => {
    // First turn: tool_use
    const stream1 = createMockStream(
      [
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t1", name: "search", input: {} } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"q":"test"}' } },
      ],
      {
        content: [{ type: "tool_use", id: "t1", name: "search", input: { q: "test" } }],
        stop_reason: "tool_use",
        usage: { input_tokens: 150, output_tokens: 75 },
      }
    );

    // Second turn: end_turn
    const stream2 = createMockStream(
      [{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Done" } }],
      {
        content: [{ type: "text", text: "Done" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 200, output_tokens: 100 },
      }
    );

    const streamFn = jest.fn().mockReturnValueOnce(stream1).mockReturnValueOnce(stream2);
    mockAnthropicConstructor.mockImplementation(() => ({
      messages: { stream: streamFn },
    }));

    // Set up MCP with tools
    mockClientInstance.listTools.mockResolvedValue({
      tools: [{ name: "search", description: "Search", inputSchema: { type: "object" } }],
    });
    mockClientInstance.callTool.mockResolvedValue({ content: [{ type: "text", text: "found it" }] });

    const events = await collectEvents(
      streamClaudeLoop("system", "search", "http://mcp:3000/mcp", "key", [])
    );

    const toolStart = events.find((e) => e.type === "tool_start");
    expect(toolStart).toBeDefined();
    if (toolStart?.type === "tool_start") {
      expect(toolStart.name).toBe("search");
    }

    const toolResult = events.find((e) => e.type === "tool_result");
    expect(toolResult).toBeDefined();
    if (toolResult?.type === "tool_result") {
      expect(toolResult.name).toBe("search");
      expect(toolResult.result).toBe("found it");
    }
  });

  it("yields error event on exception", async () => {
    mockAnthropicConstructor.mockImplementation(() => ({
      messages: {
        stream: jest.fn().mockImplementation(() => {
          throw new Error("API down");
        }),
      },
    }));

    const events = await collectEvents(
      streamClaudeLoop("system", "hi", "http://mcp:3000/mcp", "key", [])
    );

    const error = events.find((e) => e.type === "error");
    expect(error).toBeDefined();
    if (error?.type === "error") {
      expect(error.message).toContain("API down");
    }
  });
});

describe("runClaudeLoop wrapper", () => {
  it("returns LoopResult from done event (backward compatible)", async () => {
    const stream = createMockStream(
      [{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } }],
      {
        content: [{ type: "text", text: "Hello" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 50, output_tokens: 25 },
      }
    );

    mockAnthropicConstructor.mockImplementation(() => ({
      messages: { stream: jest.fn().mockReturnValue(stream) },
    }));

    const result = await runClaudeLoop("system", "hi", "http://mcp:3000/mcp", "key", []);

    expect(result.text).toBe("Hello");
    expect(result.inputTokens).toBe(50);
    expect(result.turns).toBe(1);
  });

  it("throws on error event", async () => {
    mockAnthropicConstructor.mockImplementation(() => ({
      messages: {
        stream: jest.fn().mockImplementation(() => {
          throw new Error("fail");
        }),
      },
    }));

    await expect(
      runClaudeLoop("system", "hi", "http://mcp:3000/mcp", "key", [])
    ).rejects.toThrow("fail");
  });
});
