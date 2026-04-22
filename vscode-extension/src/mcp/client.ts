// Talos MCP HTTP/SSE client.
//
// Speaks JSON-RPC 2.0 over HTTP with an SSE-style response body. Maintains a
// session ID across calls (from the `mcp-session-id` response header on init,
// echoed back in subsequent requests).
//
// Scope note: this module is transport-only — typed tool call wrappers live in
// ./tools.ts so components depend on narrow interfaces, not raw rpc.

export interface McpClientOptions {
  url: string;
  apiKey: string;
}

// All error codes the MCP server and this client surface. Union keeps
// call-site comparisons typo-safe and documents the full failure surface in
// one place. Server-side sources:
//   - tool validation: VALIDATION_ERROR
//   - identity / access: NOT_FOUND
//   - concurrency: PRECONDITION_FAILED (if_match mismatch)
//   - content rules: DANGLING_LINK, AMBIGUOUS_LINK, COLLISION
//   - derived work: EMBEDDING_FAILED
//   - generic: TOOL_ERROR (tool returned isError without a recognized code)
//   - transport: HTTP_ERROR, NO_RESPONSE, NO_RESULT, NO_CONTENT, PARSE_ERROR,
//     INIT_FAILED, RPC_ERROR
// New codes MUST be added here before being thrown in code so the compiler
// flags every consumer that should handle them.
export type McpErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "PRECONDITION_FAILED"
  | "DANGLING_LINK"
  | "AMBIGUOUS_LINK"
  | "COLLISION"
  | "EMBEDDING_FAILED"
  | "TOOL_ERROR"
  | "HTTP_ERROR"
  | "NO_RESPONSE"
  | "NO_RESULT"
  | "NO_CONTENT"
  | "PARSE_ERROR"
  | "INIT_FAILED"
  | "RPC_ERROR";

export class McpError extends Error {
  // data carries the full parsed error payload from the tool (including
  // type-specific extras like `conflicts` on COLLISION). Callers cast when
  // they need specifics — discriminated-union typing on data is deliberately
  // deferred until there's a second consumer beyond the extension.
  constructor(public code: McpErrorCode, message: string, public data?: unknown) {
    super(message);
    this.name = "McpError";
  }
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface ToolCallResult {
  content?: Array<{ type: string; text?: string }>;
  isError?: true;
}

export class McpClient {
  private sessionId: string | undefined;
  private nextId = 1;

  constructor(private readonly opts: McpClientOptions) {}

  async initialize(): Promise<void> {
    const { response, sessionId } = await this.rpc("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "talos-vscode", version: "0.1.0" },
    });
    if (sessionId) this.sessionId = sessionId;
    if (response.error) {
      throw new McpError("INIT_FAILED", response.error.message);
    }
  }

  // Calls a tool by name; parses the JSON text content into T.
  async callTool<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
    await this.ensureInitialized();
    const { response } = await this.rpc("tools/call", { name, arguments: args });
    if (response.error) {
      throw new McpError("RPC_ERROR", response.error.message);
    }
    const result = response.result as ToolCallResult | undefined;
    if (!result) {
      throw new McpError("NO_RESULT", `Tool ${name} returned no result`);
    }
    const text = result.content?.find((c) => c.type === "text")?.text;
    if (!text) {
      throw new McpError("NO_CONTENT", `Tool ${name} returned no text content`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new McpError("PARSE_ERROR", `Tool ${name} returned non-JSON text`);
    }
    if (result.isError) {
      const err = parsed as { error?: string; message?: string };
      // Pass the full parsed payload along as `data` so call sites can read
      // type-specific extras (e.g. `conflicts` on COLLISION) without
      // re-parsing.
      throw new McpError(
        (err.error as McpErrorCode) ?? "TOOL_ERROR",
        err.message ?? "Tool returned an error",
        parsed,
      );
    }
    return parsed as T;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.sessionId) await this.initialize();
  }

  private async rpc(method: string, params: unknown): Promise<{ response: JsonRpcResponse; sessionId?: string }> {
    const body = JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method, params });
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${this.opts.apiKey}`,
      "Accept": "application/json, text/event-stream",
    };
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;

    const res = await fetch(this.opts.url, { method: "POST", headers, body });
    const sessionId = res.headers.get("mcp-session-id") ?? undefined;
    const ct = res.headers.get("Content-Type") ?? "";
    const raw = await res.text();

    if (!res.ok) {
      throw new McpError("HTTP_ERROR", `${res.status} ${res.statusText}: ${raw.slice(0, 300)}`);
    }

    let response: JsonRpcResponse | undefined;
    if (ct.includes("text/event-stream")) {
      for (const line of raw.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        try {
          const parsed = JSON.parse(line.slice(6)) as JsonRpcResponse;
          if (parsed.id !== undefined) {
            response = parsed;
            break;
          }
        } catch {
          // ignore non-JSON SSE frames
        }
      }
    } else {
      response = JSON.parse(raw) as JsonRpcResponse;
    }
    if (!response) {
      throw new McpError("NO_RESPONSE", "Server returned no JSON-RPC response frame");
    }
    return { response, sessionId };
  }
}
