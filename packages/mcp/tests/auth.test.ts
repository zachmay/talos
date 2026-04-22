import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

// Create a temp agent_keys file for testing
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const tmpDir = join(import.meta.dirname, "../.test-tmp");
if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
const keysPath = join(tmpDir, "agent_keys");
writeFileSync(keysPath, JSON.stringify({ "valid-key-123": "agent-alpha", "valid-key-456": "agent-beta" }));

// Set env so auth module can find keys
process.env.AGENT_KEYS_PATH = keysPath;

const authModule = await import("../src/auth.js").catch(() => null);

function mockReq(headers: Record<string, string> = {}): Partial<Request> {
  return { headers, agentId: undefined as unknown as string };
}
function mockRes(): Partial<Response> {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("MCP-07: Authentication Middleware", () => {
  it("module loads successfully", () => {
    expect(authModule).not.toBeNull();
    expect(authModule!.authMiddleware).toBeDefined();
    expect(authModule!.loadAgentKeys).toBeDefined();
  });

  it("returns 401 AUTH_REQUIRED when no Authorization header", () => {
    const req = mockReq({});
    const res = mockRes();
    const next = vi.fn();
    authModule!.authMiddleware(req as Request, res as Response, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: "AUTH_REQUIRED" }));
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 AUTH_REQUIRED for malformed Authorization header", () => {
    const req = mockReq({ authorization: "Basic abc123" });
    const res = mockRes();
    const next = vi.fn();
    authModule!.authMiddleware(req as Request, res as Response, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: "AUTH_REQUIRED" }));
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 AUTH_INVALID for unknown API key", () => {
    const req = mockReq({ authorization: "Bearer unknown-key" });
    const res = mockRes();
    const next = vi.fn();
    authModule!.authMiddleware(req as Request, res as Response, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: "AUTH_INVALID" }));
    expect(next).not.toHaveBeenCalled();
  });

  it("sets req.agentId for valid API key and calls next()", () => {
    const req = mockReq({ authorization: "Bearer valid-key-123" });
    const res = mockRes();
    const next = vi.fn();
    authModule!.authMiddleware(req as Request, res as Response, next);
    expect((req as any).agentId).toBe("agent-alpha");
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("loadAgentKeys parses a keys file", () => {
    const keys = authModule!.loadAgentKeys(keysPath);
    expect(keys).toEqual({ "valid-key-123": "agent-alpha", "valid-key-456": "agent-beta" });
  });
});
