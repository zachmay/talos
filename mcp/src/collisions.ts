// Shared collision-detection helper used by insert and update.
//
// "Collision" = another entry already exists at (path, title). Case-sensitive.
// Returns the conflicting UUIDs if any; otherwise an empty array.
//
// excludeId skips a specific row — used by update so an entry's own state
// doesn't count as a collision against itself.

import type { PoolClient } from "pg";

export async function findCollisions(
  client: PoolClient,
  path: string[],
  title: string,
  excludeId?: string,
): Promise<string[]> {
  const params: unknown[] = [path, title];
  let sql =
    "SELECT id FROM entries WHERE path = $1::text[] AND title = $2";
  if (excludeId) {
    sql += " AND id <> $3";
    params.push(excludeId);
  }
  const result = await client.query(sql, params);
  return result.rows.map((r: { id: string }) => r.id);
}
