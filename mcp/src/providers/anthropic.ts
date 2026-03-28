// NOT VERIFIED: Anthropic does not have a confirmed public embeddings REST API
// as of research date (2026-03-27). This stub will throw EMBEDDING_FAILED at
// runtime. Use OpenRouter with an Anthropic-compatible model instead.
// See RESEARCH.md Open Question #1.

import type { EmbeddingProvider } from "./interface.js";

export class AnthropicProvider implements EmbeddingProvider {
  readonly dimensions: number;

  constructor() {
    this.dimensions = parseInt(process.env.VECTOR_DIMENSIONS ?? "1536", 10);
  }

  async embed(_text: string): Promise<number[]> {
    throw new Error(
      "EMBEDDING_FAILED: Anthropic embeddings API not verified — use EMBEDDING_PROVIDER=openrouter"
    );
  }
}
