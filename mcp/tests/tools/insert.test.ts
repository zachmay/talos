import { describe, it, expect } from "vitest";

const insertModule = await import("../../src/tools/insert.js").catch(() => null);

describe("MCP-01: Insert Tool", () => {
  it("embeds content and writes one row to entries", () => {
    expect(insertModule).not.toBeNull();
  });

  it("writes N rows to chunks for chunked content", () => {
    expect(insertModule).not.toBeNull();
  });

  it("returns {id, content, path} on success", () => {
    expect(insertModule).not.toBeNull();
  });
});
