import type { SSEEvent } from "../../../shared/types.js";

/**
 * Parse an array of SSE lines into SSEEvent objects.
 * Lines are split on \n; empty lines delimit events.
 */
export function parseSSELines(lines: string[]): SSEEvent[] {
  const events: SSEEvent[] = [];
  let eventType = "message";
  let dataBuffer: string | null = null;

  for (const line of lines) {
    if (line.startsWith("event: ")) {
      eventType = line.slice(7);
    } else if (line.startsWith("data: ")) {
      dataBuffer = line.slice(6);
    } else if (line === "" && dataBuffer !== null) {
      events.push({ type: eventType, data: dataBuffer });
      eventType = "message";
      dataBuffer = null;
    }
  }

  return events;
}

/**
 * Stream SSE events from a URL using native fetch().
 * Yields SSEEvent objects as they arrive.
 */
export async function* streamSSE(
  url: string,
  token: string,
): AsyncGenerator<SSEEvent> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "text/event-stream",
    },
  });

  if (!response.ok) {
    throw new Error(`SSE connection failed: ${response.status}`);
  }
  if (!response.body) {
    throw new Error("SSE response has no body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventType = "message";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // Last element may be incomplete — keep it in buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          eventType = line.slice(7);
        } else if (line.startsWith("data: ")) {
          yield { type: eventType, data: line.slice(6) };
          eventType = "message";
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
