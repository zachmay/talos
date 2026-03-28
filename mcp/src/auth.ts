import { readFileSync, existsSync } from "fs";
import type { Request, Response, NextFunction } from "express";

declare global {
  namespace Express {
    interface Request {
      agentId: string;
    }
  }
}

export function loadAgentKeys(path: string): Record<string, string> {
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as Record<string, string>;
}

function resolveKeysPath(): string {
  const dockerPath = "/run/secrets/agent_keys";
  if (existsSync(dockerPath)) return dockerPath;
  if (process.env.AGENT_KEYS_PATH) return process.env.AGENT_KEYS_PATH;
  throw new Error("Cannot find agent_keys — set AGENT_KEYS_PATH for local dev");
}

const agentKeys = loadAgentKeys(resolveKeysPath());

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "AUTH_REQUIRED", message: "Authorization header required" });
    return;
  }

  const token = authHeader.slice(7);
  const agentId = agentKeys[token];
  if (!agentId) {
    res.status(403).json({ error: "AUTH_INVALID", message: "Invalid API key" });
    return;
  }

  req.agentId = agentId;
  next();
}
