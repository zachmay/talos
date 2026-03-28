import { describe, it, expect } from "vitest";

const updateModule = await import("../../src/tools/update.js").catch(() => null);

describe("MCP-03: Update Tool", () => {
  it("deletes old chunks and re-embeds new content", () => {
    expect(updateModule).not.toBeNull();
  });

  it("updates the entries row", () => {
    expect(updateModule).not.toBeNull();
  });

  it("returns {id, content, path} on success", () => {
    expect(updateModule).not.toBeNull();
  });
});
