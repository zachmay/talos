import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadSystemPrompt } from "../prompt.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "entrypoint-test-"));
}

describe("entrypoint: AGENT.md loading and prompt injection", () => {
  test("loadSystemPrompt replaces {{SKILL_INDEX}} with skill index", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(
      path.join(dir, "AGENT.md"),
      "You are an agent.\n\nSkills:\n{{SKILL_INDEX}}\n\nGo.",
      "utf8"
    );
    const result = loadSystemPrompt(
      path.join(dir, "AGENT.md"),
      "- web-search: Search the web"
    );
    expect(result).toContain("- web-search: Search the web");
    expect(result).not.toContain("{{SKILL_INDEX}}");
  });

  test("loadSystemPrompt uses fallback when skill index is empty", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(
      path.join(dir, "AGENT.md"),
      "Skills:\n{{SKILL_INDEX}}",
      "utf8"
    );
    const result = loadSystemPrompt(path.join(dir, "AGENT.md"), "");
    expect(result).toContain("(no repo skills loaded)");
    expect(result).not.toContain("{{SKILL_INDEX}}");
  });

  test("loadSystemPrompt reads AGENT.md content correctly", () => {
    const dir = makeTmpDir();
    const content = "Hello agent! {{SKILL_INDEX}} end.";
    fs.writeFileSync(path.join(dir, "AGENT.md"), content, "utf8");
    const result = loadSystemPrompt(path.join(dir, "AGENT.md"), "skill-line");
    expect(result).toBe("Hello agent! skill-line end.");
  });

  test("loadSystemPrompt throws if AGENT.md is missing", () => {
    expect(() =>
      loadSystemPrompt("/tmp/nonexistent-" + Date.now() + "/AGENT.md", "")
    ).toThrow();
  });
});
