import * as vscode from "vscode";

const API_KEY_SECRET = "talos.apiKey";

export function getServerUrl(): string {
  return vscode.workspace.getConfiguration("talos").get<string>("serverUrl") ?? "http://localhost:3001/mcp";
}

export async function getApiKey(ctx: vscode.ExtensionContext): Promise<string | undefined> {
  return ctx.secrets.get(API_KEY_SECRET);
}

export async function setApiKey(ctx: vscode.ExtensionContext, key: string): Promise<void> {
  await ctx.secrets.store(API_KEY_SECRET, key);
}

export async function clearApiKey(ctx: vscode.ExtensionContext): Promise<void> {
  await ctx.secrets.delete(API_KEY_SECRET);
}

// Prompts for the API key when one isn't stored. Returns the key if the user
// provided one (and persists it via secrets), or undefined if they dismissed.
export async function ensureApiKey(ctx: vscode.ExtensionContext): Promise<string | undefined> {
  const existing = await getApiKey(ctx);
  if (existing) return existing;

  const input = await vscode.window.showInputBox({
    title: "Talos API Key",
    prompt: "Paste your Talos MCP bearer token. Stored in VS Code secret storage.",
    password: true,
    ignoreFocusOut: true,
  });
  if (!input) return undefined;
  await setApiKey(ctx, input);
  return input;
}
