import type { EmbeddingProvider } from "./interface.js";

export class OpenAIProvider implements EmbeddingProvider {
  readonly dimensions: number;
  private readonly model: string;
  private readonly apiKey: string;

  constructor() {
    this.model = process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";
    this.apiKey = process.env.EMBEDDING_API_KEY ?? "";
    this.dimensions = parseInt(process.env.VECTOR_DIMENSIONS ?? "1536", 10);
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: text }),
    });

    if (!res.ok) {
      throw new Error(`EMBEDDING_FAILED: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    return data.data[0].embedding;
  }
}
