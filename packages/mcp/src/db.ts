import pg from "pg";
const { Pool } = pg;
import type { PoolClient } from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

// Startup validation for chunk config
function validateChunkConfig(): void {
  const size = process.env.CHUNK_SIZE ? parseInt(process.env.CHUNK_SIZE, 10) : undefined;
  const overlap = process.env.CHUNK_OVERLAP ? parseInt(process.env.CHUNK_OVERLAP, 10) : undefined;
  if (size !== undefined && overlap !== undefined && overlap >= size) {
    throw new Error(
      `CHUNK_OVERLAP (${overlap}) must be less than CHUNK_SIZE (${size})`
    );
  }
}
validateChunkConfig();

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

export async function withAgent<T>(
  agentId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.agent_id', $1, true)", [agentId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
