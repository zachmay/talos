/**
 * Talos Agent Entrypoint
 *
 * Placeholder entrypoint for the sandboxed agent container.
 * Full implementation in Phase 3 Plan 03-04.
 */

const provider = process.env.AGENT_LLM_PROVIDER || 'claude';
const model = process.env.AGENT_LLM_MODEL || 'claude-sonnet-4-6';
const mcpUrl = process.env.MCP_SERVER_URL || 'http://mcp:3000/mcp';

console.error(`[talos-agent] provider=${provider} model=${model} mcp=${mcpUrl}`);
console.error('[talos-agent] Agent container started. Waiting for input...');

// Keep process alive
process.stdin.resume();
process.stdin.on('data', (data) => {
  const input = data.toString().trim();
  if (input === 'exit' || input === 'quit') {
    console.error('[talos-agent] Shutting down.');
    process.exit(0);
  }
  console.log(`[talos-agent] Received: ${input} (full agent loop not yet implemented)`);
});
