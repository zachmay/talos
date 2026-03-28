import type { EmbeddingProvider } from "./interface.js";

export class OllamaProvider implements EmbeddingProvider {
  readonly dimensions: number;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor() {
    this.model = process.env.EMBEDDING_MODEL ?? "nomic-embed-text";
    this.baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
    this.dimensions = parseInt(process.env.VECTOR_DIMENSIONS ?? "768", 10);
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, prompt: text }),
    });

    if (!res.ok) {
      throw new Error(`EMBEDDING_FAILED: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    return data.embedding;
  }
}
