export function chunkText(text: string, chunkSize: number, chunkOverlap: number): string[] {
  if (chunkOverlap >= chunkSize) {
    throw new Error(
      `CHUNK_OVERLAP (${chunkOverlap}) must be less than CHUNK_SIZE (${chunkSize})`
    );
  }

  if (text.length <= chunkSize) return [text];

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    if (end === text.length) break;
    start += chunkSize - chunkOverlap;
  }
  return chunks;
}
