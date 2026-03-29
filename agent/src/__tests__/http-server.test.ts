/**
 * Tests for agent HTTP server (SSE streaming, auth, session guard, /btw queue).
 * Uses jest.unstable_mockModule for ESM compatibility.
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import type { Express } from "express";

// Mock startAgentLoop before importing http-server
const mockStartAgentLoop = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.unstable_mockModule("../agent.js", () => ({
  startAgentLoop: mockStartAgentLoop,
}));

// Dynamic import after mock
let createApp: typeof import("../http-server.js")["createApp"];

beforeEach(async () => {
  jest.clearAllMocks();
  const mod = await import("../http-server.js");
  createApp = mod.createApp;
});

function makeDeps() {
  return {
    systemPrompt: "test prompt",
    conversationHistory: [] as unknown[],
    model: "test-model",
    profile: "test-profile",
    getLastResult: () => ({
      text: "ok",
      inputTokens: 1000,
      outputTokens: 500,
      contextLimit: 10000,
      turns: 1,
    }),
    setLastResult: jest.fn(),
  };
}

function makeApp(token = "test-token-123") {
  return createApp(makeDeps() as any, token);
}

// Inline supertest-like helper using native http
async function request(app: Express, method: string, path: string, opts?: { headers?: Record<string, string>; body?: unknown }) {
  const http = await import("node:http");
  const server = app.listen(0);
  const addr = server.address() as import("node:net").AddressInfo;

  return new Promise<{ status: number; body: any; headers: Record<string, string> }>((resolve, reject) => {
    const bodyStr = opts?.body ? JSON.stringify(opts.body) : undefined;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: addr.port,
        path,
        method: method.toUpperCase(),
        headers: {
          ...opts?.headers,
          ...(bodyStr ? { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(bodyStr)) } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          server.close();
          let body: any;
          try { body = JSON.parse(data); } catch { body = data; }
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (typeof v === "string") headers[k] = v;
          }
          resolve({ status: res.statusCode!, body, headers });
        });
      }
    );
    req.on("error", (e) => { server.close(); reject(e); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

describe("http-server", () => {
  describe("auth middleware", () => {
    it("rejects POST /chat/message without Authorization header with 401", async () => {
      const app = makeApp();
      const res = await request(app, "POST", "/chat/message", { body: { message: "hi" } });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("AUTH_REQUIRED");
    });

    it("rejects POST /chat/message with wrong token with 401", async () => {
      const app = makeApp();
      const res = await request(app, "POST", "/chat/message", {
        headers: { Authorization: "Bearer wrong-token" },
        body: { message: "hi" },
      });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("AUTH_REQUIRED");
    });
  });

  describe("session guard", () => {
    it("returns 409 SESSION_ACTIVE on second SSE connection", async () => {
      const app = makeApp();
      const http = await import("node:http");
      const server = app.listen(0);
      const addr = server.address() as import("node:net").AddressInfo;

      // First SSE connection
      const firstConn = new Promise<void>((resolve) => {
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port: addr.port,
            path: "/chat/stream",
            method: "GET",
            headers: { Authorization: "Bearer test-token-123" },
          },
          (res) => {
            // SSE connected — headers flushed
            res.on("data", () => {});
            resolve();
          }
        );
        req.end();
      });

      await firstConn;
      // Small delay for session to register
      await new Promise((r) => setTimeout(r, 50));

      // Second SSE attempt
      const secondRes = await new Promise<{ status: number; body: any }>((resolve) => {
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port: addr.port,
            path: "/chat/stream",
            method: "GET",
            headers: { Authorization: "Bearer test-token-123" },
          },
          (res) => {
            let data = "";
            res.on("data", (c) => (data += c));
            res.on("end", () => {
              let body: any;
              try { body = JSON.parse(data); } catch { body = data; }
              resolve({ status: res.statusCode!, body });
            });
          }
        );
        req.end();
      });

      expect(secondRes.status).toBe(409);
      expect(secondRes.body.error).toBe("SESSION_ACTIVE");
      server.close();
    });
  });

  describe("/status", () => {
    it("returns 200 with SessionInfo shape on valid auth", async () => {
      const app = makeApp();
      const res = await request(app, "GET", "/status", {
        headers: { Authorization: "Bearer test-token-123" },
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual(
        expect.objectContaining({
          profile: "test-profile",
          model: "test-model",
          contextPct: expect.any(Number),
          tokens: expect.any(Number),
          connected: expect.any(Boolean),
        })
      );
    });
  });

  describe("/chat/btw", () => {
    it("queues btw message while processing and returns 202", async () => {
      // Make startAgentLoop hang so isProcessing stays true
      let resolveLoop: () => void;
      mockStartAgentLoop.mockImplementation(
        () => new Promise<any>((r) => { resolveLoop = () => r({ text: "", inputTokens: 0, outputTokens: 0, contextLimit: 0, turns: 0 }); })
      );

      const deps = makeDeps();
      const app = createApp(deps as any, "test-token-123");
      const http = await import("node:http");
      const server = app.listen(0);
      const addr = server.address() as import("node:net").AddressInfo;

      // Open SSE session
      await new Promise<void>((resolve) => {
        const req = http.request(
          { hostname: "127.0.0.1", port: addr.port, path: "/chat/stream", method: "GET", headers: { Authorization: "Bearer test-token-123" } },
          (res) => { res.on("data", () => {}); resolve(); }
        );
        req.end();
      });
      await new Promise((r) => setTimeout(r, 50));

      // Send a message to start processing
      await new Promise<void>((resolve, reject) => {
        const req = http.request(
          { hostname: "127.0.0.1", port: addr.port, path: "/chat/message", method: "POST", headers: { Authorization: "Bearer test-token-123", "Content-Type": "application/json" } },
          (res) => { res.on("data", () => {}); res.on("end", () => resolve()); }
        );
        req.write(JSON.stringify({ message: "first" }));
        req.end();
      });
      await new Promise((r) => setTimeout(r, 50));

      // Now send a /btw while processing
      const btwRes = await new Promise<{ status: number; body: any }>((resolve) => {
        const req = http.request(
          { hostname: "127.0.0.1", port: addr.port, path: "/chat/btw", method: "POST", headers: { Authorization: "Bearer test-token-123", "Content-Type": "application/json" } },
          (res) => {
            let data = "";
            res.on("data", (c) => (data += c));
            res.on("end", () => { resolve({ status: res.statusCode!, body: JSON.parse(data) }); });
          }
        );
        req.write(JSON.stringify({ message: "btw msg" }));
        req.end();
      });

      expect(btwRes.status).toBe(202);
      expect(btwRes.body.queued).toBe(true);

      // Cleanup
      resolveLoop!();
      await new Promise((r) => setTimeout(r, 50));
      server.close();
    });
  });
});
