import { useState, useCallback } from "react";
import { randomUUID } from "node:crypto";
import type { AgentEvent, LoopResult } from "../../../shared/types.js";

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  result?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  thinking?: string;
  tools: ToolCall[];
  timestamp: Date;
  isStreaming: boolean;
  turns?: number;
  tokens?: number;
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const onAgentEvent = useCallback((event: AgentEvent) => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      const current: ChatMessage =
        last && last.role === "agent" && last.isStreaming
          ? { ...last }
          : {
              id: randomUUID(),
              role: "agent",
              text: "",
              tools: [],
              timestamp: new Date(),
              isStreaming: true,
            };

      const isNew = !(last && last.role === "agent" && last.isStreaming);
      const rest = isNew ? prev : prev.slice(0, -1);

      switch (event.type) {
        case "token":
          current.text += event.text;
          break;
        case "thinking":
          current.thinking = (current.thinking ?? "") + event.text;
          break;
        case "tool_start":
          current.tools = [
            ...current.tools,
            { name: event.name, input: event.input },
          ];
          break;
        case "tool_result": {
          const tools = [...current.tools];
          const lastTool = tools[tools.length - 1];
          if (lastTool) {
            tools[tools.length - 1] = { ...lastTool, result: event.result };
            current.tools = tools;
          }
          break;
        }
        case "done": {
          const result = event.result as LoopResult;
          current.isStreaming = false;
          current.turns = result.turns;
          current.tokens = result.inputTokens + result.outputTokens;
          process.stdout.write("\u0007");
          break;
        }
        case "error":
          current.text += `\n[Error: ${event.message}]`;
          current.isStreaming = false;
          break;
      }

      return [...rest, current];
    });
  }, []);

  const addUserMessage = useCallback((text: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: randomUUID(),
        role: "user",
        text,
        tools: [],
        timestamp: new Date(),
        isStreaming: false,
      },
    ]);
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  return { messages, onAgentEvent, addUserMessage, clearMessages };
}
