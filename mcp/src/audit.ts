import type { PoolClient } from "pg";

export async function withAudit<T>(
  db: PoolClient,
  agentId: string,
  operation: "insert" | "update" | "delete",
  targetId: string | null,
  details: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  // Run the data write first -- if it throws, no audit entry is written
  const result = await fn();

  // Insert audit entry on the same connection (same transaction as the write)
  await db.query(
    `INSERT INTO audit_log (agent_id, operation, target_id, details)
     VALUES ($1, $2, $3, $4)`,
    [agentId, operation, targetId, JSON.stringify(details)]
  );

  return result;
}
