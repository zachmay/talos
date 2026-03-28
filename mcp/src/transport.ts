import express from "express";
import { randomUUID } from "crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";
import { authMiddleware } from "./auth.js";
import type { Request, Response, NextFunction } from "express";

// --- Origin validation middleware (MCP spec 2025-06-18) ---

function originGuard(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers["origin"];
  if (origin) {
    const allowed = (process.env.ALLOWED_ORIGINS ?? "").split(",").filter(Boolean);
    if (!allowed.includes(origin)) {
      res.status(403).json({ error: "ORIGIN_REJECTED", message: "Origin not allowed" });
      return;
    }
  }
  // No Origin header = direct API call = allowed
  next();
}

// --- Structured logging helper ---

function log(level: string, message: string, extra?: Record<string, unknown>): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...extra,
  };
  process.stdout.write(JSON.stringify(entry) + "\n");
}

// --- App setup ---

const app = express();
app.use(express.json());

// Health check (no auth)
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// Session map: sessionId -> { transport, server }
const sessions = new Map<string, { transport: StreamableHTTPServerTransport }>();

// Apply middleware on /mcp routes
app.post("/mcp", originGuard, authMiddleware, async (req: Request, res: Response) => {
  const agentId = req.agentId;

  // Check for existing session
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    await session.transport.handleRequest(req, res, req.body);
    log("info", "mcp-tool-call", { agentId, sessionId });
    return;
  }

  // New session — create transport + server
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  const server = createServer(agentId);
  await server.connect(transport);

  // Store session after connect so sessionId is assigned
  const newSessionId = transport.sessionId!;
  sessions.set(newSessionId, { transport });

  // Clean up on close
  transport.onclose = () => {
    sessions.delete(newSessionId);
    log("info", "session-closed", { agentId, sessionId: newSessionId });
  };

  await transport.handleRequest(req, res, req.body);
  log("info", "session-created", { agentId, sessionId: newSessionId });
});

app.get("/mcp", originGuard, authMiddleware, async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).json({ error: "NO_SESSION", message: "Invalid or missing session ID" });
    return;
  }
  const session = sessions.get(sessionId)!;
  await session.transport.handleRequest(req, res);
});

app.delete("/mcp", originGuard, authMiddleware, async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).json({ error: "NO_SESSION", message: "Invalid or missing session ID" });
    return;
  }
  const session = sessions.get(sessionId)!;
  await session.transport.handleRequest(req, res);
});

// --- Start ---

const port = parseInt(process.env.PORT ?? "3000", 10);
app.listen(port, () => {
  log("info", "talos-mcp started", {
    port,
    embedding_provider: process.env.EMBEDDING_PROVIDER ?? "openrouter",
  });
});
