import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We'll test the exported functions directly
const { registerFetchTool, _isAllowedDomain } = await import("../../src/tools/fetch.js");

describe("MCP fetch tool", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.ALLOWED_DOMAINS;
    delete process.env.ALLOW_ALL_DOMAINS;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("domain allowlisting", () => {
    it("rejects domain not in ALLOWED_DOMAINS", () => {
      process.env.ALLOWED_DOMAINS = "example.com";
      expect(_isAllowedDomain("https://evil.com/data")).toBe(false);
    });

    it("allows domain in ALLOWED_DOMAINS", () => {
      process.env.ALLOWED_DOMAINS = "example.com,api.github.com";
      expect(_isAllowedDomain("https://example.com/page")).toBe(true);
      expect(_isAllowedDomain("https://api.github.com/repos")).toBe(true);
    });

    it("allows subdomains of allowed domains", () => {
      process.env.ALLOWED_DOMAINS = "example.com";
      expect(_isAllowedDomain("https://sub.example.com/page")).toBe(true);
    });

    it("allows all domains when ALLOW_ALL_DOMAINS=true", () => {
      process.env.ALLOW_ALL_DOMAINS = "true";
      expect(_isAllowedDomain("https://anything.com/page")).toBe(true);
    });

    it("denies all when no allowlist configured", () => {
      expect(_isAllowedDomain("https://example.com")).toBe(false);
    });

    it("returns false for invalid URLs", () => {
      process.env.ALLOWED_DOMAINS = "example.com";
      expect(_isAllowedDomain("not-a-url")).toBe(false);
    });
  });

  describe("registerFetchTool", () => {
    it("registers a tool named fetch on the server", () => {
      const mockServer = { registerTool: vi.fn() };
      registerFetchTool(mockServer);
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        "fetch",
        expect.objectContaining({ title: expect.any(String) }),
        expect.any(Function)
      );
    });

    it("handler returns error for blocked domain", async () => {
      const mockServer = { registerTool: vi.fn() };
      registerFetchTool(mockServer);
      const handler = mockServer.registerTool.mock.calls[0][2];
      const result = await handler({ url: "https://blocked.com", method: "GET" });
      expect(result.content[0].text).toContain("not in allowlist");
    });

    it("handler truncates response at 100,000 characters", async () => {
      process.env.ALLOW_ALL_DOMAINS = "true";
      const longText = "x".repeat(150_000);
      const mockFetch = vi.fn().mockResolvedValue({
        text: async () => longText,
      });
      vi.stubGlobal("fetch", mockFetch);

      const mockServer = { registerTool: vi.fn() };
      registerFetchTool(mockServer);
      const handler = mockServer.registerTool.mock.calls[0][2];
      const result = await handler({ url: "https://example.com", method: "GET" });
      expect(result.content[0].text.length).toBe(100_000);

      vi.unstubAllGlobals();
    });

    it("handler returns error text for network errors", async () => {
      process.env.ALLOW_ALL_DOMAINS = "true";
      const mockFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
      vi.stubGlobal("fetch", mockFetch);

      const mockServer = { registerTool: vi.fn() };
      registerFetchTool(mockServer);
      const handler = mockServer.registerTool.mock.calls[0][2];
      const result = await handler({ url: "https://example.com", method: "GET" });
      expect(result.content[0].text).toContain("ECONNREFUSED");
      expect(result.content[0].text).toContain("[error]");

      vi.unstubAllGlobals();
    });
  });
});
