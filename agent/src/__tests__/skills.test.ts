import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildSkillIndex } from "../skills.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "skills-test-"));
}

function createSkill(
  skillsDir: string,
  dirName: string,
  frontmatter: string
): void {
  const dir = path.join(skillsDir, dirName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), frontmatter, "utf8");
}

describe("skills: skill index building", () => {
  test("buildSkillIndex parses YAML frontmatter from SKILL.md files", () => {
    const dir = makeTmpDir();
    createSkill(
      dir,
      "web-search",
      "---\nname: web-search\ndescription: Search the web\n---\n\n# Web Search"
    );
    expect(buildSkillIndex(dir)).toBe("- web-search: Search the web");
  });

  test("buildSkillIndex returns empty string when skills directory is empty", () => {
    const dir = makeTmpDir();
    expect(buildSkillIndex(dir)).toBe("");
  });

  test("buildSkillIndex returns empty string for non-existent directory", () => {
    expect(buildSkillIndex("/tmp/does-not-exist-" + Date.now())).toBe("");
  });

  test("buildSkillIndex skips directories without SKILL.md", () => {
    const dir = makeTmpDir();
    fs.mkdirSync(path.join(dir, "no-skill"), { recursive: true });
    createSkill(
      dir,
      "valid",
      "---\nname: valid\ndescription: A valid skill\n---\n"
    );
    expect(buildSkillIndex(dir)).toBe("- valid: A valid skill");
  });

  test("buildSkillIndex formats index as '- name: description' lines", () => {
    const dir = makeTmpDir();
    createSkill(dir, "a", "---\nname: alpha\ndescription: First\n---\n");
    createSkill(dir, "b", "---\nname: beta\ndescription: Second\n---\n");
    const result = buildSkillIndex(dir);
    expect(result).toContain("- alpha: First");
    expect(result).toContain("- beta: Second");
  });

  test("buildSkillIndex skips SKILL.md with malformed frontmatter", () => {
    const dir = makeTmpDir();
    createSkill(dir, "bad", "no frontmatter here");
    createSkill(dir, "good", "---\nname: good\ndescription: Works\n---\n");
    expect(buildSkillIndex(dir)).toBe("- good: Works");
  });

  test("buildSkillIndex skips SKILL.md with missing name or description", () => {
    const dir = makeTmpDir();
    createSkill(dir, "noname", "---\ndescription: Missing name\n---\n");
    createSkill(dir, "nodesc", "---\nname: nodesc\n---\n");
    expect(buildSkillIndex(dir)).toBe("");
  });
});

