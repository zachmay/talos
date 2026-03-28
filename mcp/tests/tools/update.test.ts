import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before importing module under test
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

const mockWithAgent = vi.mocked(withAgent);
const mockCreateEmbeddingProvider = vi.mocked(createEmbeddingProvider);
const mockChunkText = vi.mocked(chunkText);

// We'll import the handler function directly for unit testing
const { handleUpdate } = await import("../../src/tools/update.js").catch(() => ({
  handleUpdate: null,
}));

describe("MCP-03: Update Tool", () => {
  const agentId = "agent-1";
  const entryId = "00000000-0000-0000-0000-000000000001";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports handleUpdate function", () => {
    expect(handleUpdate).not.toBeNull();
    expect(typeof handleUpdate).toBe("function");
  });

  it("content update re-embeds and replaces chunks", async () => {
    const mockEmbed = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);
    mockCreateEmbeddingProvider.mockReturnValue({
      embed: mockEmbed,
      dimensions: 3,
    });
    mockChunkText.mockReturnValue(["chunk1", "chunk2"]);

    const mockClient = {
      query: vi.fn()
        // DELETE old chunks
        .mockResolvedValueOnce({ rowCount: 2 })
        // UPDATE entries SET content
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: entryId, content: "new text", path: ["a"] }],
        })
        // INSERT chunk 1
        .mockResolvedValueOnce({ rowCount: 1 })
        // INSERT chunk 2
        .mockResolvedValueOnce({ rowCount: 1 }),
    };

    mockWithAgent.mockImplementation(async (_agentId, fn) => {
      return fn(mockClient as any);
    });

    const result = await handleUpdate!({
      agentId,
      id: entryId,
      content: "new text",
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe(entryId);
    expect(parsed.content).toBe("new text");
    // Embedding was called for each chunk
    expect(mockEmbed).toHaveBeenCalledTimes(2);
    // Old chunks were deleted
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM chunks"),
      [entryId]
    );
  });

  it("metadata-only update skips embedding", async () => {
    const mockEmbed = vi.fn();
    mockCreateEmbeddingProvider.mockReturnValue({
      embed: mockEmbed,
      dimensions: 3,
    });

    const mockClient = {
      query: vi.fn().mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: entryId, content: "old text", path: ["a"] }],
      }),
    };

    mockWithAgent.mockImplementation(async (_agentId, fn) => {
      return fn(mockClient as any);
    });

    const result = await handleUpdate!({
      agentId,
      id: entryId,
      metadata: { tag: "y" },
    });

    expect(result.isError).toBeUndefined();
    expect(mockEmbed).not.toHaveBeenCalled();
    expect(mockChunkText).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND for unknown entry_id", async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValueOnce({ rowCount: 0, rows: [] }),
    };
    // For metadata-only path: UPDATE returns 0 rows
    mockWithAgent.mockImplementation(async (_agentId, fn) => {
      return fn(mockClient as any);
    });

    const result = await handleUpdate!({
      agentId,
      id: entryId,
      metadata: { tag: "z" },
    });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("NOT_FOUND");
  });

  it("returns VALIDATION_ERROR for empty content", async () => {
    const result = await handleUpdate!({
      agentId,
      id: entryId,
      content: "",
    });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("VALIDATION_ERROR");
  });

  it("returns VALIDATION_ERROR when neither content nor metadata provided", async () => {
    const result = await handleUpdate!({
      agentId,
      id: entryId,
    });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("VALIDATION_ERROR");
  });

  it("rolls back on embedding failure", async () => {
    const mockEmbed = vi.fn().mockRejectedValue(new Error("EMBEDDING_FAILED"));
    mockCreateEmbeddingProvider.mockReturnValue({
      embed: mockEmbed,
      dimensions: 3,
    });
    mockChunkText.mockReturnValue(["chunk1"]);

    const result = await handleUpdate!({
      agentId,
      id: entryId,
      content: "new text",
    });

    expect(result.isError).toBe(true);
    // withAgent was NOT called since embedding happens before transaction
    expect(mockWithAgent).not.toHaveBeenCalled();
  });

  it("verbose returns metadata, updated_at, chunk_count", async () => {
    const mockEmbed = vi.fn().mockResolvedValue([0.1, 0.2]);
    mockCreateEmbeddingProvider.mockReturnValue({
      embed: mockEmbed,
      dimensions: 2,
    });
    mockChunkText.mockReturnValue(["chunk1"]);

    const mockClient = {
      query: vi.fn()
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{
            id: entryId,
            content: "new",
            path: ["a"],
            metadata: { tag: "x" },
            updated_at: "2026-01-01T00:00:00Z",
          }],
        })
        .mockResolvedValueOnce({ rowCount: 1 }),
    };

    mockWithAgent.mockImplementation(async (_agentId, fn) => {
      return fn(mockClient as any);
    });

    const result = await handleUpdate!({
      agentId,
      id: entryId,
      content: "new",
      verbose: true,
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.metadata).toBeDefined();
    expect(parsed.updated_at).toBeDefined();
    expect(parsed.chunk_count).toBe(1);
  });
});
