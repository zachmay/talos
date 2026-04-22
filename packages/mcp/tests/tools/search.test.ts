import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/db.js", () => ({
  withAgent: vi.fn(),
}));

vi.mock("../../src/providers/interface.js", () => ({
  createEmbeddingProvider: vi.fn(),
}));

import { withAgent } from "../../src/db.js";
import { createEmbeddingProvider } from "../../src/providers/interface.js";

const { registerSearchTool, _handleSearch } = await import("../../src/tools/search.js");

describe("MCP-02: Search Tool", () => {
  const mockClient = {
    query: vi.fn(),
  };
  const mockProvider = {
    embed: vi.fn(),
    dimensions: 1536,
  };

  const sampleRows = [
    { id: "entry-1", content: "hello world", path: ["tasks"], metadata: { tag: "x" }, similarity: 0.85, matched_chunk: "hello", created_at: "2026-01-01" },
    { id: "entry-2", content: "goodbye world", path: [], metadata: null, similarity: 0.75, matched_chunk: "goodbye", created_at: "2026-01-02" },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (createEmbeddingProvider as any).mockReturnValue(mockProvider);
    mockProvider.embed.mockResolvedValue(new Array(1536).fill(0));
    (withAgent as any).mockImplementation(async (_id: string, fn: any) => fn(mockClient));
    mockClient.query.mockResolvedValue({ rows: sampleRows });
  });

  it("exports registerSearchTool function", () => {
    expect(registerSearchTool).toBeDefined();
    expect(typeof registerSearchTool).toBe("function");
  });

  it("exports _handleSearch for testing", () => {
    expect(_handleSearch).toBeDefined();
    expect(typeof _handleSearch).toBe("function");
  });

  it("rejects when neither query nor path provided", async () => {
    const result = await _handleSearch({}, "agent-1");
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("VALIDATION_ERROR");
  });

  it("semantic search: embeds query and calls match_entries", async () => {
    const result = await _handleSearch({ query: "hello" }, "agent-1");

    expect(mockProvider.embed).toHaveBeenCalledWith("hello");
    expect(withAgent).toHaveBeenCalledWith("agent-1", expect.any(Function));
    const sql = mockClient.query.mock.calls[0][0];
    expect(sql).toContain("match_entries");

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(2);
  });

  it("returns minimal {id, content, path} by default", async () => {
    const result = await _handleSearch({ query: "hello" }, "agent-1");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed[0]).toHaveProperty("id");
    expect(parsed[0]).toHaveProperty("content");
    expect(parsed[0]).toHaveProperty("path");
    expect(parsed[0]).not.toHaveProperty("similarity");
    expect(parsed[0]).not.toHaveProperty("matched_chunk");
  });

  it("returns verbose fields when verbose: true", async () => {
    const result = await _handleSearch({ query: "hello", verbose: true }, "agent-1");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed[0]).toHaveProperty("similarity");
    expect(parsed[0]).toHaveProperty("metadata");
    expect(parsed[0]).toHaveProperty("created_at");
    expect(parsed[0]).toHaveProperty("matched_chunk");
  });

  it("path-only mode: queries entries directly without embedding", async () => {
    mockClient.query.mockResolvedValue({
      rows: [{ id: "entry-1", content: "hello", path: ["tasks"] }],
    });

    const result = await _handleSearch({ path: ["tasks"] }, "agent-1");

    expect(mockProvider.embed).not.toHaveBeenCalled();
    expect(withAgent).toHaveBeenCalled();
    const sql = mockClient.query.mock.calls[0][0];
    expect(sql).toContain("SELECT");
    expect(sql).not.toContain("match_entries");

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
  });

  it("combined query + path passes path to match_entries", async () => {
    await _handleSearch({ query: "hello", path: ["tasks"] }, "agent-1");

    const params = mockClient.query.mock.calls[0][1];
    // path should be passed as a parameter (as array)
    expect(params[4]).toEqual(["tasks"]);
  });

  it("returns empty array when no results", async () => {
    mockClient.query.mockResolvedValue({ rows: [] });

    const result = await _handleSearch({ query: "nothing" }, "agent-1");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual([]);
    expect(result.isError).toBeUndefined();
  });

  it("passes threshold and count to match_entries", async () => {
    await _handleSearch({ query: "hello", threshold: 0.9, count: 5 }, "agent-1");

    const params = mockClient.query.mock.calls[0][1];
    expect(params).toContain(0.9);
    expect(params).toContain(5);
  });

  it("passes metadata filter to match_entries", async () => {
    await _handleSearch({ query: "hello", filter: { tag: "x" } }, "agent-1");

    const params = mockClient.query.mock.calls[0][1];
    // filter should be JSON stringified in params
    expect(params.some((p: any) => typeof p === "string" && p.includes("tag"))).toBe(true);
  });

  it("does not include embedding vectors in response", async () => {
    const result = await _handleSearch({ query: "hello", verbose: true }, "agent-1");
    const text = result.content[0].text;
    // Should never contain an array of 1536 zeros
    expect(text).not.toContain("[0,0,0,0,0");
  });
});
