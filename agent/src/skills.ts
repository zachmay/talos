import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

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
