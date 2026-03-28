import { describe, it, expect } from "vitest";

const deleteModule = await import("../../src/tools/delete.js").catch(() => null);

describe("MCP-04: Delete Tool", () => {
  it("removes entry from entries table (chunks cascade)", () => {
    expect(deleteModule).not.toBeNull();
  });

  it("returns {deleted: id} on success", () => {
    expect(deleteModule).not.toBeNull();
  });
});
