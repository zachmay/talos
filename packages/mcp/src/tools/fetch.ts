import { z } from "zod";

export function _isAllowedDomain(urlStr: string): boolean {
  if (process.env.ALLOW_ALL_DOMAINS === "true") return true;
  const allowed = (process.env.ALLOWED_DOMAINS ?? "").split(",").map(d => d.trim()).filter(Boolean);
  if (allowed.length === 0) return false;
  try {
    const { hostname } = new URL(urlStr);
    return allowed.some(d => hostname === d || hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

export function registerFetchTool(server: any): void {
  server.registerTool(
    "fetch",
    {
      title: "Fetch URL",
      description: "Fetch content from a URL. Subject to domain allowlist (ALLOWED_DOMAINS env var or ALLOW_ALL_DOMAINS=true).",
      inputSchema: z.object({
        url: z.string().url(),
        method: z.enum(["GET", "POST"]).default("GET"),
        headers: z.record(z.string()).optional(),
        body: z.string().optional()
      })
    },
    async ({ url, method, headers, body }: { url: string; method: string; headers?: Record<string, string>; body?: string }) => {
      if (!_isAllowedDomain(url)) {
        return { content: [{ type: "text" as const, text: `[error]: Domain not in allowlist. Set ALLOWED_DOMAINS or ALLOW_ALL_DOMAINS=true.` }] };
      }
      try {
        const res = await fetch(url, { method, headers, body });
        const text = await res.text();
        return { content: [{ type: "text" as const, text: text.slice(0, 100_000) }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `[error]: fetch failed: ${err.message}` }] };
      }
    }
  );
}
