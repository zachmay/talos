import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { buildSkillIndex } from "./skills.js";
import { loadSystemPrompt } from "./prompt.js";
import { startAgentLoop } from "./agent.js";

const AGENT_DIR = process.env.AGENT_DIR ?? "/app/agent";
const agentMdPath = path.join(AGENT_DIR, "AGENT.md");

// Startup: load system prompt
let systemPrompt: string;
try {
  const skillIndex = buildSkillIndex(path.join(AGENT_DIR, "skills"));
  systemPrompt = loadSystemPrompt(agentMdPath, skillIndex);
  process.stderr.write(
    `Agent ready. System prompt: ${systemPrompt.length} chars\n`
  );
} catch (err) {
  process.stderr.write(
    `[fatal] Failed to load AGENT.md from ${agentMdPath}: ${err}\n`
  );
  process.exit(1);
}

// Stdin loop
const rl = readline.createInterface({ input: process.stdin });
process.stdout.write("> ");

rl.on("line", async (line: string) => {
  const input = line.trim();
  if (!input) {
    process.stdout.write("> ");
    return;
  }
  try {
    const response = await startAgentLoop(systemPrompt, input);
    process.stdout.write(response + "\n> ");
  } catch (err) {
    process.stderr.write(`[error] ${err}\n`);
    process.stdout.write("[error]: Agent loop failed. See logs.\n> ");
  }
});
