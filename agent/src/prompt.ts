import fs from "node:fs";

/**
 * Load AGENT.md and inject skill index into the {{SKILL_INDEX}} placeholder.
 * Uses "(no repo skills loaded)" fallback when skill index is empty.
 */
export function loadSystemPrompt(
  agentMdPath: string,
  skillIndex: string
): string {
  throw new Error("Not implemented");
}
