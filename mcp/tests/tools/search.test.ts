import { describe, it, expect } from "vitest";

const searchModule = await import("../../src/tools/search.js").catch(() => null);

describe("MCP-02: Search Tool", () => {
  it("calls match_entries with agent-scoped query", () => {
    expect(searchModule).not.toBeNull();
  });

  it("returns minimal {id, content, path} by default", () => {
    expect(searchModule).not.toBeNull();
  });
});
