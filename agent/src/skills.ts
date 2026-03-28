import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import yaml from "js-yaml";

const execFileAsync = promisify(execFile);

interface SkillMeta {
  name: string;
  description: string;
}

/**
 * Scan a skills directory and build a compact index string from SKILL.md frontmatter.
 * Returns empty string if directory is empty or doesn't exist.
 */
export function buildSkillIndex(skillsDir: string): string {
  if (!fs.existsSync(skillsDir)) return "";
  const skills: SkillMeta[] = [];

  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillMdPath = path.join(skillsDir, entry.name, "SKILL.md");
    if (!fs.existsSync(skillMdPath)) continue;

    try {
      const content = fs.readFileSync(skillMdPath, "utf8");
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      if (!match) continue;
      const meta = yaml.load(match[1]) as SkillMeta;
      if (meta?.name && meta?.description) skills.push(meta);
    } catch {
      continue; // skip malformed
    }
  }

  return skills.map((s) => `- ${s.name}: ${s.description}`).join("\n");
}

/**
 * Execute a skill script as a child process with timeout and output capture.
 * Uses execFile (not exec) to avoid shell injection.
 *
 * @param skillName - Name of the skill directory
 * @param args - Arguments to pass to the script
 * @param skillsBaseDir - Base directory containing skill directories (default: /app/agent/skills)
 * @param timeout - Timeout in ms (default: 30000)
 */
export async function executeSkill(
  skillName: string,
  args: string[],
  skillsBaseDir: string = "/app/agent/skills",
  timeout: number = 30_000
): Promise<string> {
  const scriptPath = path.join(skillsBaseDir, skillName, "run.js");

  try {
    const { stdout, stderr } = await execFileAsync(
      "node",
      [scriptPath, ...args],
      { timeout, maxBuffer: 1024 * 512 }
    );
    return stdout + (stderr ? `\n[stderr]: ${stderr}` : "");
  } catch (err: unknown) {
    const e = err as { killed?: boolean; signal?: string; message?: string };
    if (e.killed || e.signal === "SIGTERM") {
      return `[error]: Skill ${skillName} timed out after 30s`;
    }
    return `[error]: ${e.message ?? "Unknown error"}`;
  }
}
