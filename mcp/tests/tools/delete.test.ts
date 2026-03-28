import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/db.js", () => ({
  withAgent: vi.fn(),
}));

import { withAgent } from "../../src/db.js";

const mockWithAgent = vi.mocked(withAgent);

const { handleDelete } = await import("../../src/tools/delete.js").catch(() => ({
  handleDelete: null,
}));

describe("MCP-04: Delete Tool", () => {
  const agentId = "agent-1";
  const entryId = "00000000-0000-0000-0000-000000000001";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports handleDelete function", () => {
    expect(handleDelete).not.toBeNull();
    expect(typeof handleDelete).toBe("function");
  });

  it("removes entry and returns {deleted: id}", async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: entryId }],
      }),
    };

    mockWithAgent.mockImplementation(async (_agentId, fn) => {
      return fn(mockClient as any);
    });

    const result = await handleDelete!({ agentId, id: entryId });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.deleted).toBe(entryId);

    // Verify DELETE query was issued
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM entries"),
      [entryId]
    );
  });

  it("returns NOT_FOUND for unknown id", async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValueOnce({ rowCount: 0, rows: [] }),
    };

    mockWithAgent.mockImplementation(async (_agentId, fn) => {
      return fn(mockClient as any);
    });

    const result = await handleDelete!({ agentId, id: entryId });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("NOT_FOUND");
  });

  it("does not return deleted content in response", async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: entryId }],
      }),
    };

    mockWithAgent.mockImplementation(async (_agentId, fn) => {
      return fn(mockClient as any);
    });

    const result = await handleDelete!({ agentId, id: entryId });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.content).toBeUndefined();
    expect(parsed.deleted).toBe(entryId);
  });
});
