import { describe, it, expect, beforeEach, vi } from "vitest";

// We need to reset modules between tests to pick up env changes
describe("MCP-05: Provider Factory", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.EMBEDDING_PROVIDER;
    delete process.env.EMBEDDING_API_KEY;
    delete process.env.EMBEDDING_MODEL;
    delete process.env.VECTOR_DIMENSIONS;
    process.env.EMBEDDING_API_KEY = "test-key";
  });

  it("defaults to OpenRouterProvider when EMBEDDING_PROVIDER is unset", async () => {
    const { createEmbeddingProvider } = await import("../../src/providers/interface.js");
    const provider = createEmbeddingProvider();
    expect(provider.constructor.name).toBe("OpenRouterProvider");
  });

  it("returns OpenRouterProvider when EMBEDDING_PROVIDER=openrouter", async () => {
    process.env.EMBEDDING_PROVIDER = "openrouter";
    const { createEmbeddingProvider } = await import("../../src/providers/interface.js");
    const provider = createEmbeddingProvider();
    expect(provider.constructor.name).toBe("OpenRouterProvider");
  });

  it("returns OllamaProvider when EMBEDDING_PROVIDER=ollama", async () => {
    process.env.EMBEDDING_PROVIDER = "ollama";
    const { createEmbeddingProvider } = await import("../../src/providers/interface.js");
    const provider = createEmbeddingProvider();
    expect(provider.constructor.name).toBe("OllamaProvider");
  });

  it("returns OpenAIProvider when EMBEDDING_PROVIDER=openai", async () => {
    process.env.EMBEDDING_PROVIDER = "openai";
    const { createEmbeddingProvider } = await import("../../src/providers/interface.js");
    const provider = createEmbeddingProvider();
    expect(provider.constructor.name).toBe("OpenAIProvider");
  });

  it("returns AnthropicProvider when EMBEDDING_PROVIDER=anthropic", async () => {
    process.env.EMBEDDING_PROVIDER = "anthropic";
    const { createEmbeddingProvider } = await import("../../src/providers/interface.js");
    const provider = createEmbeddingProvider();
    expect(provider.constructor.name).toBe("AnthropicProvider");
  });

  it("throws for unknown EMBEDDING_PROVIDER value", async () => {
    process.env.EMBEDDING_PROVIDER = "unknown-provider";
    const { createEmbeddingProvider } = await import("../../src/providers/interface.js");
    expect(() => createEmbeddingProvider()).toThrow("Unknown EMBEDDING_PROVIDER: unknown-provider");
  });

  it("every provider has embed() and dimensions", async () => {
    for (const name of ["openrouter", "openai", "ollama", "anthropic"]) {
      process.env.EMBEDDING_PROVIDER = name;
      const { createEmbeddingProvider } = await import("../../src/providers/interface.js");
      const provider = createEmbeddingProvider();
      expect(typeof provider.embed).toBe("function");
      expect(typeof provider.dimensions).toBe("number");
      expect(provider.dimensions).toBeGreaterThan(0);
    }
  });
});
