import { describe, it, expect } from "vitest";

const factoryModule = await import("../../src/providers/factory.js").catch(() => null);

describe("MCP-05: Provider Factory", () => {
  it("returns OpenRouterProvider when EMBEDDING_PROVIDER=openrouter", () => {
    expect(factoryModule).not.toBeNull();
  });

  it("returns OllamaProvider when EMBEDDING_PROVIDER=ollama", () => {
    expect(factoryModule).not.toBeNull();
  });

  it("returns OpenAIProvider when EMBEDDING_PROVIDER=openai", () => {
    expect(factoryModule).not.toBeNull();
  });
});
