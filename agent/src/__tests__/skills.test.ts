import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { buildSkillIndex, executeSkill } from "../skills.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

describe("skills: skill execution", () => {
  test("executeSkill runs node run.js and returns stdout", async () => {
    const dir = makeTmpDir();
    const skillDir = path.join(dir, "echo-skill");
    fs.mkdirSync(skillDir);
    fs.writeFileSync(
      path.join(skillDir, "run.js"),
      'process.stdout.write("hello world");',
      "utf8"
    );
    const result = await executeSkill("echo-skill", [], dir);
    expect(result).toBe("hello world");
  });

  test("executeSkill returns error message when script exits non-zero", async () => {
    const dir = makeTmpDir();
    const skillDir = path.join(dir, "fail-skill");
    fs.mkdirSync(skillDir);
    fs.writeFileSync(
      path.join(skillDir, "run.js"),
      "process.exit(1);",
      "utf8"
    );
    const result = await executeSkill("fail-skill", [], dir);
    expect(result).toMatch(/^\[error\]:/);
  });

  test("executeSkill enforces 30s timeout and returns timeout error message", async () => {
    const dir = makeTmpDir();
    const skillDir = path.join(dir, "slow-skill");
    fs.mkdirSync(skillDir);
    fs.writeFileSync(
      path.join(skillDir, "run.js"),
      "setTimeout(() => {}, 60000);",
      "utf8"
    );
    // Override timeout to 1s for test speed
    const result = await executeSkill("slow-skill", [], dir, 1000);
    expect(result).toMatch(/\[error\]:.*timed out/i);
  }, 10000);

  test("executeSkill does not use shell:true (uses execFile, not exec)", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "skills.ts"),
      "utf8"
    );
    expect(src).toContain("execFile");
    // Ensure no standalone 'exec(' that isn't 'execFile('
    const lines = src.split("\n");
    for (const line of lines) {
      if (line.includes("exec(") && !line.includes("execFile")) {
        fail("Found 'exec(' without 'execFile' — potential shell injection risk");
      }
    }
  });
});
