import fs from "node:fs";

/**
 * Load AGENT.md and inject skill index into the {{SKILL_INDEX}} placeholder.
 * Uses "(no repo skills loaded)" fallback when skill index is empty.
 */
export function loadSystemPrompt(
  agentMdPath: string,
  skillIndex: string
): string {
  const content = fs.readFileSync(agentMdPath, "utf8");
  const effectiveIndex = skillIndex || "(no repo skills loaded)";
  return content.replace("{{SKILL_INDEX}}", effectiveIndex);
}
