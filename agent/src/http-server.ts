import express, { Request, Response, NextFunction } from "express";
import fs from "node:fs";
import type { AgentEvent, ChatRequest, SessionInfo } from "../../shared/types.js";
import type { LoopResult } from "./providers/claude.js";
import { startAgentLoop } from "./agent.js";
import type Anthropic from "@anthropic-ai/sdk";

const PORT = parseInt(process.env.AGENT_API_PORT ?? "3001", 10);
const HOST = process.env.AGENT_API_HOST ?? "0.0.0.0";

function loadTuiToken(): string {
  try {
    return fs.readFileSync("/run/secrets/tui_token", "utf8").trim();
  } catch {
    return process.env.TALOS_TUI_TOKEN ?? "";
  }
}

export interface HttpServerDeps {
  systemPrompt: string;
  conversationHistory: Anthropic.MessageParam[];
  model: string;
  profile: string;
  getLastResult: () => LoopResult | null;
  setLastResult: (r: LoopResult) => void;
}

interface ActiveSession {
  res: Response;
}

/**
 * Creates an Express app for testing (no listen).
 * @param deps - server dependencies
 * @param token - pre-loaded TUI token (for testing; production uses loadTuiToken)
 */
export function createApp(deps: HttpServerDeps, token: string): express.Express {
  const app = express();
  let activeSession: ActiveSession | null = null;
  let isProcessing = false;
  const btwQueue: string[] = [];

  function authMiddleware(req: Request, res: Response, next: NextFunction): void {
    const auth = req.headers.authorization;
    if (!token || !auth?.startsWith("Bearer ") || auth.slice(7) !== token) {
      res.status(401).json({ error: "AUTH_REQUIRED" });
      return;
    }
    next();
  }

  function sendEvent(type: string, data: unknown): void {
    if (!activeSession) return;
    activeSession.res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  app.get("/chat/stream", authMiddleware, (req: Request, res: Response) => {
    if (activeSession) {
      res.status(409).json({ error: "SESSION_ACTIVE" });
      return;
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    activeSession = { res };
    req.on("close", () => {
      activeSession = null;
    });
  });

  app.post("/chat/message", authMiddleware, express.json(), async (req: Request, res: Response) => {
    if (!activeSession) {
      res.status(409).json({ error: "NO_SESSION" });
      return;
    }
    const { message } = req.body as ChatRequest;
    res.status(202).json({ queued: true });
    void processMessage(message);
  });

  app.post("/chat/btw", authMiddleware, express.json(), (req: Request, res: Response) => {
    const { message } = req.body as ChatRequest;
    if (isProcessing) {
      btwQueue.push(message);
      res.status(202).json({ queued: true });
    } else {
      res.status(202).json({ queued: true });
      void processMessage(message);
    }
  });

  app.get("/status", authMiddleware, (req: Request, res: Response) => {
    const last = deps.getLastResult();
    const contextPct =
      last && last.contextLimit > 0
        ? Math.round((last.inputTokens / last.contextLimit) * 100)
        : 0;
    const info: SessionInfo = {
      profile: deps.profile,
      model: deps.model,
      contextPct,
      tokens: last?.inputTokens ?? 0,
      connected: activeSession !== null,
    };
    res.json(info);
  });

  async function processMessage(message: string): Promise<void> {
    isProcessing = true;
    deps.conversationHistory.push({ role: "user", content: message });
    try {
      const onEvent = (event: AgentEvent) => {
        sendEvent(event.type, event);
        if (event.type === "done") {
          deps.setLastResult(event.result);
        }
      };
      await startAgentLoop(deps.systemPrompt, message, deps.conversationHistory, onEvent);
      // Drain btw queue
      while (btwQueue.length > 0 && activeSession) {
        const btw = btwQueue.shift()!;
        deps.conversationHistory.push({ role: "user", content: btw });
        await startAgentLoop(deps.systemPrompt, btw, deps.conversationHistory, onEvent);
      }
    } finally {
      isProcessing = false;
      sendEvent("idle", {});
    }
  }

  return app;
}

/**
 * Starts the HTTP server on configured port/host.
 * Called from entrypoint.ts alongside the readline loop.
 */
export function startHttpServer(deps: HttpServerDeps): void {
  const token = loadTuiToken();
  const app = createApp(deps, token);
  app.listen(PORT, HOST, () => {
    process.stderr.write(`[http-server] Listening on ${HOST}:${PORT}\n`);
  });
}
