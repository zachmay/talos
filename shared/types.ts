// Shared type contract between agent HTTP server and TUI client.
// Pure types — no runtime code, no imports.

export interface LoopResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  contextLimit: number;
  turns: number;
}

export type AgentEvent =
  | { type: "thinking"; text: string }
  | { type: "tool_start"; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; name: string; result: string }
  | { type: "token"; text: string }
  | { type: "done"; result: LoopResult }
  | { type: "error"; message: string };

export interface SSEEvent {
  type: string;
  data: string;
}

export interface ChatRequest {
  message: string;
}

export interface ChatResponse {
  queued: boolean;
}

export interface SessionInfo {
  profile: string;
  model: string;
  contextPct: number;
  tokens: number;
  connected: boolean;
}

export interface HealthStatus {
  db: boolean;
  mcp: boolean;
  llm: boolean;
  embed: boolean;
}
