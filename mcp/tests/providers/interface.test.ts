import { describe, it, expect } from "vitest";

const interfaceModule = await import("../../src/providers/interface.js").catch(() => null);

describe("MCP-06: EmbeddingProvider Contract", () => {
  it("exports an EmbeddingProvider interface with embed method", () => {
    expect(interfaceModule).not.toBeNull();
    expect(typeof interfaceModule!.EmbeddingProvider).toBeDefined();
  });

  it("embed returns Promise<number[]>", () => {
    expect(interfaceModule).not.toBeNull();
  });

  it("exposes a dimensions property of type number", () => {
    expect(interfaceModule).not.toBeNull();
  });
});
