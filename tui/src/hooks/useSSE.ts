import { useState, useEffect, useCallback, useRef } from "react";
import { streamSSE } from "../lib/sse-parser.js";
import type { AgentEvent } from "../../../shared/types.js";

export type ConnectionStatus = "connected" | "reconnecting" | "disconnected";

interface UseSSEOptions {
  url: string;
  token: string;
  onEvent: (event: AgentEvent) => void;
}

export function useSSE({ url, token, onEvent }: UseSSEOptions) {
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("disconnected");
  const cancelledRef = useRef(false);
  const backoffRef = useRef(1000);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const connect = useCallback(async () => {
    if (cancelledRef.current) return;
    try {
      setConnectionStatus("connected");
      for await (const sseEvent of streamSSE(url, token)) {
        if (cancelledRef.current) break;
        try {
          const parsed = JSON.parse(sseEvent.data) as AgentEvent;
          onEventRef.current(parsed);
        } catch {
          // skip unparseable events
        }
      }
    } catch {
      // connection error
    }

    if (cancelledRef.current) return;
    setConnectionStatus("reconnecting");

    const delay = backoffRef.current;
    backoffRef.current = Math.min(delay * 2, 30000);
    await new Promise((r) => setTimeout(r, delay));

    if (!cancelledRef.current) {
      void connect();
    }
  }, [url, token]);

  useEffect(() => {
    cancelledRef.current = false;
    backoffRef.current = 1000;
    void connect();
    return () => {
      cancelledRef.current = true;
    };
  }, [connect]);

  const reconnect = useCallback(() => {
    cancelledRef.current = true;
    setTimeout(() => {
      cancelledRef.current = false;
      backoffRef.current = 1000;
      void connect();
    }, 0);
  }, [connect]);

  return { connectionStatus, reconnect };
}
