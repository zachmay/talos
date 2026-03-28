import { describe, it, expect } from "vitest";

describe("MCP-06: EmbeddingProvider Contract", () => {
  it("exports createEmbeddingProvider function", async () => {
    const mod = await import("../../src/providers/interface.js");
    expect(typeof mod.createEmbeddingProvider).toBe("function");
  });

  it("returned provider has embed method and dimensions property", async () => {
    process.env.EMBEDDING_PROVIDER = "openrouter";
    process.env.EMBEDDING_API_KEY = "test-key";
    const { createEmbeddingProvider } = await import("../../src/providers/interface.js");
    const provider = createEmbeddingProvider();
    expect(typeof provider.embed).toBe("function");
    expect(typeof provider.dimensions).toBe("number");
  });
});
