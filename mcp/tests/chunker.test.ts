import { describe, it, expect } from "vitest";

const chunkerModule = await import("../src/chunker.js").catch(() => null);

describe("chunkText", () => {
  it("module loads successfully", () => {
    expect(chunkerModule).not.toBeNull();
    expect(chunkerModule!.chunkText).toBeDefined();
  });

  it("returns single-element array when text fits in one chunk", () => {
    const result = chunkerModule!.chunkText("hello", 10, 2);
    expect(result).toEqual(["hello"]);
  });

  it("splits text into overlapping chunks", () => {
    // 10 chars, chunkSize=4, overlap=1 => step=3
    // chunks: [0,4), [3,7), [6,10)
    const result = chunkerModule!.chunkText("abcdefghij", 4, 1);
    expect(result).toEqual(["abcd", "defg", "ghij"]);
  });

  it("handles last chunk being shorter", () => {
    // 7 chars, chunkSize=4, overlap=1 => step=3
    // [0,4), [3,7)
    const result = chunkerModule!.chunkText("abcdefg", 4, 1);
    expect(result).toEqual(["abcd", "defg"]);
  });

  it("throws when overlap >= chunkSize", () => {
    expect(() => chunkerModule!.chunkText("abc", 3, 3)).toThrow("CHUNK_OVERLAP");
    expect(() => chunkerModule!.chunkText("abc", 3, 5)).toThrow("CHUNK_OVERLAP");
  });
});
