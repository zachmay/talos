import { OpenRouterProvider } from "./openrouter.js";
import { OpenAIProvider } from "./openai.js";
import { OllamaProvider } from "./ollama.js";
import { AnthropicProvider } from "./anthropic.js";

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  readonly dimensions: number;
}

/**
 * Factory — the ONLY way tool handlers should get a provider.
 * Selection is driven by EMBEDDING_PROVIDER env var.
 */
export function createEmbeddingProvider(): EmbeddingProvider {
  const provider = process.env.EMBEDDING_PROVIDER ?? "openrouter";

  switch (provider) {
    case "openrouter":
      return new OpenRouterProvider();
    case "openai":
      return new OpenAIProvider();
    case "ollama":
      return new OllamaProvider();
    case "anthropic":
      return new AnthropicProvider();
    default:
      throw new Error(`Unknown EMBEDDING_PROVIDER: ${provider}`);
  }
}
