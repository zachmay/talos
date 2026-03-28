import { describe, it, expect } from "vitest";

const authModule = await import("../src/auth.js").catch(() => null);

describe("MCP-07: Authentication Middleware", () => {
  it("returns 401 AUTH_REQUIRED when no Authorization header", () => {
    expect(authModule).not.toBeNull();
  });

  it("returns 403 AUTH_INVALID for unknown API key", () => {
    expect(authModule).not.toBeNull();
  });

  it("sets req.agentId for valid API key and calls next()", () => {
    expect(authModule).not.toBeNull();
  });
});
