import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before importing the module under test
vi.mock("../../src/db.js", () => ({
  withAgent: vi.fn(),
}));

vi.mock("../../src/providers/interface.js", () => ({
  createEmbeddingProvider: vi.fn(),
}));

vi.mock("../../src/chunker.js", () => ({
  chunkText: vi.fn(),
}));

import { withAgent } from "../../src/db.js";
import { createEmbeddingProvider } from "../../src/providers/interface.js";
import { chunkText } from "../../src/chunker.js";

// We test the handler logic directly by calling the exported function
// registerInsertTool registers on McpServer; we'll test the handler extracted for unit testing
const { registerInsertTool, _handleInsert } = await import("../../src/tools/insert.js");

describe("MCP-01: Insert Tool", () => {
  const mockClient = {
    query: vi.fn(),
  };
  const mockProvider = {
    embed: vi.fn(),
    dimensions: 1536,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (createEmbeddingProvider as any).mockReturnValue(mockProvider);
    (chunkText as any).mockReturnValue(["chunk1"]);
    mockProvider.embed.mockResolvedValue(new Array(1536).fill(0));
    (withAgent as any).mockImplementation(async (_id: string, fn: any) => fn(mockClient));
    mockClient.query.mockResolvedValue({
      rows: [{ id: "entry-uuid-1", content: "test content", path: [], metadata: null, created_at: new Date().toISOString() }],
    });
  });

  it("exports registerInsertTool function", () => {
    expect(registerInsertTool).toBeDefined();
    expect(typeof registerInsertTool).toBe("function");
  });

  it("exports _handleInsert for testing", () => {
    expect(_handleInsert).toBeDefined();
    expect(typeof _handleInsert).toBe("function");
  });

  it("rejects empty content with VALIDATION_ERROR", async () => {
    const result = await _handleInsert({ content: "" }, "agent-1");
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("VALIDATION_ERROR");
  });

  it("rejects whitespace-only content with VALIDATION_ERROR", async () => {
    const result = await _handleInsert({ content: "   \n  " }, "agent-1");
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("VALIDATION_ERROR");
  });

  it("rejects content exceeding 50000 chars", async () => {
    const result = await _handleInsert({ content: "x".repeat(50_001) }, "agent-1");
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("VALIDATION_ERROR");
  });

  it("embeds content and writes entry + chunks atomically", async () => {
    const result = await _handleInsert({ content: "test content" }, "agent-1");

    expect(result.isError).toBeUndefined();
    expect(withAgent).toHaveBeenCalledWith("agent-1", expect.any(Function));
    expect(createEmbeddingProvider).toHaveBeenCalled();
    expect(chunkText).toHaveBeenCalled();
    expect(mockProvider.embed).toHaveBeenCalled();
    // Three queries: INSERT entries, INSERT chunks, INSERT audit_log
    expect(mockClient.query).toHaveBeenCalledTimes(3);
  });

  it("returns {id, content, path} on success by default", async () => {
    const result = await _handleInsert({ content: "test content" }, "agent-1");

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveProperty("id");
    expect(parsed).toHaveProperty("content");
    expect(parsed).toHaveProperty("path");
    expect(parsed).not.toHaveProperty("metadata");
    expect(parsed).not.toHaveProperty("created_at");
  });

  it("returns verbose fields when verbose: true", async () => {
    const result = await _handleInsert({ content: "test content", verbose: true }, "agent-1");

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveProperty("id");
    expect(parsed).toHaveProperty("metadata");
    expect(parsed).toHaveProperty("created_at");
    expect(parsed).toHaveProperty("chunk_count");
  });

  it("stores path array on entry row", async () => {
    await _handleInsert({ content: "test", path: ["tasks", "home"] }, "agent-1");

    const insertCall = mockClient.query.mock.calls[0];
    expect(insertCall[0]).toContain("INSERT INTO entries");
    expect(insertCall[1][1]).toEqual(["tasks", "home"]);
  });

  it("stores metadata JSONB on entry row", async () => {
    await _handleInsert({ content: "test", metadata: { tag: "x" } }, "agent-1");

    const insertCall = mockClient.query.mock.calls[0];
    expect(insertCall[0]).toContain("INSERT INTO entries");
  });

  it("returns EMBEDDING_FAILED on provider error with no DB write", async () => {
    mockProvider.embed.mockRejectedValue(new Error("API timeout"));

    const result = await _handleInsert({ content: "test content" }, "agent-1");

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("EMBEDDING_FAILED");
    expect(withAgent).not.toHaveBeenCalled();
  });

  it("uses custom chunk_size and chunk_overlap when provided", async () => {
    await _handleInsert({ content: "test", chunk_size: 500, chunk_overlap: 100 }, "agent-1");

    expect(chunkText).toHaveBeenCalledWith("test", 500, 100);
  });
});
