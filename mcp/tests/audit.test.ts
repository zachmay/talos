import { describe, it, expect, vi } from "vitest";

const { withAudit } = await import("../src/audit.js").catch(() => ({
  withAudit: null,
}));

describe("Phase 4: withAudit middleware", () => {
  it("exports withAudit function", () => {
    expect(withAudit).not.toBeNull();
    expect(typeof withAudit).toBe("function");
  });

  it("runs fn() then inserts audit row on same client", async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
    };

    const fnResult = { id: "test-id" };
    const fn = vi.fn().mockResolvedValue(fnResult);

    const result = await withAudit!(
      mockClient,
      "agent-1",
      "insert",
      "00000000-0000-0000-0000-000000000001",
      {},
      fn
    );

    // fn() called first
    expect(fn).toHaveBeenCalledOnce();
    // audit INSERT on same client
    expect(mockClient.query).toHaveBeenCalledOnce();
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO audit_log"),
      expect.arrayContaining(["agent-1", "insert"])
    );
    // returns fn result
    expect(result).toBe(fnResult);
  });

  it("does not insert audit row when fn() throws", async () => {
    const mockClient = {
      query: vi.fn(),
    };

    const fn = vi.fn().mockRejectedValue(new Error("DB_ERROR"));

    await expect(
      withAudit!(mockClient, "agent-1", "delete", null, {}, fn)
    ).rejects.toThrow("DB_ERROR");

    // No audit insert
    expect(mockClient.query).not.toHaveBeenCalled();
  });

  it("passes details as JSON string", async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
    };

    const details = { table: "entries" };
    await withAudit!(
      mockClient,
      "agent-1",
      "update",
      "00000000-0000-0000-0000-000000000002",
      details,
      async () => "ok"
    );

    expect(mockClient.query).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([JSON.stringify(details)])
    );
  });
});
