import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import type Anthropic from "@anthropic-ai/sdk";
import { buildSkillIndex } from "./skills.js";
import { loadSystemPrompt } from "./prompt.js";
import { startAgentLoop } from "./agent.js";
import type { LoopResult } from "./providers/claude.js";

const AGENT_DIR = process.env.AGENT_DIR ?? "/app/agent";
const AGENT_PROFILE = process.env.AGENT_PROFILE ?? "agent";
const MODEL = process.env.AGENT_LLM_MODEL ?? "claude-sonnet-4-6";
const agentMdPath = path.join(AGENT_DIR, "AGENT.md");

// Startup: load system prompt
let systemPrompt: string;
try {
  const skillIndex = buildSkillIndex(path.join(AGENT_DIR, "skills"));
  systemPrompt = loadSystemPrompt(agentMdPath, skillIndex);
} catch (err) {
  process.stderr.write(
    `[fatal] Failed to load AGENT.md from ${agentMdPath}: ${err}\n`
  );
  process.exit(1);
}

const conversationHistory: Anthropic.MessageParam[] = [];
let lastResult: LoopResult | null = null;

function renderPrompt(): string {
  const parts: string[] = [];

  // Context usage
  if (lastResult && lastResult.contextLimit > 0) {
    const pct = Math.round((lastResult.inputTokens / lastResult.contextLimit) * 100);
    parts.push(`${pct}%`);
  } else {
    parts.push("0%");
  }

  // Model (short name)
  const shortModel = MODEL.replace("claude-", "").replace("-20251001", "");
  parts.push(shortModel);

  // Agent name
  parts.push(AGENT_PROFILE);

  return `[${parts.join(" | ")}] > `;
}

// Banner
process.stdout.write(`\n  talos agent\n`);
process.stdout.write(`  model: ${MODEL}\n`);
process.stdout.write(`  profile: ${AGENT_PROFILE}\n`);
process.stdout.write(`  prompt: ${systemPrompt.length} chars\n\n`);

const rl = readline.createInterface({ input: process.stdin });
process.stdout.write(renderPrompt());

rl.on("close", () => {
  process.stdout.write("\n");
  process.exit(0);
});

rl.on("line", async (line: string) => {
  const input = line.trim();
  if (!input) {
    process.stdout.write(renderPrompt());
    return;
  }
  if (input === "/quit" || input === "/exit") {
    process.stdout.write("Goodbye.\n");
    process.exit(0);
  }
  try {
    lastResult = await startAgentLoop(systemPrompt, input, conversationHistory);
    process.stdout.write(lastResult.text + "\n");
    process.stdout.write(renderPrompt());
  } catch (err) {
    process.stderr.write(`[error] ${err}\n`);
    process.stdout.write("[error]: Agent loop failed. See logs.\n");
    process.stdout.write(renderPrompt());
  }
});
