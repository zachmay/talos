import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { useSSE } from "./hooks/useSSE.js";
import { useChat } from "./hooks/useChat.js";
import { useHealth } from "./hooks/useHealth.js";
import { HealthBar } from "./components/HealthBar.js";
import { ChatView } from "./components/ChatView.js";
import { StatusBar } from "./components/StatusBar.js";
import type { SessionInfo } from "../../shared/types.js";

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
}

const host = getArg("host") ?? "http://localhost:3001";
const token = getArg("token") ?? process.env["TALOS_AGENT_TOKEN"];

if (!token) {
  console.error("Error: --token or TALOS_AGENT_TOKEN required");
  process.exit(1);
}

export function App() {
  const app = useApp();
  const { messages, onAgentEvent, addUserMessage, clearMessages } = useChat();
  const { connectionStatus, reconnect } = useSSE({
    url: `${host}/events`,
    token: token!,
    onEvent: onAgentEvent,
  });
  const { health } = useHealth();

  const [session, setSession] = useState<SessionInfo>({
    profile: "",
    model: "",
    contextPct: 0,
    tokens: 0,
    connected: false,
  });
  const [scrollOffset, setScrollOffset] = useState(0);
  const [lastCtrlC, setLastCtrlC] = useState(0);

  // Fetch /status on mount for welcome message
  useEffect(() => {
    fetch(`${host}/status`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json() as Promise<SessionInfo>)
      .then((info) => {
        setSession(info);
        addUserMessage(
          `Connected to ${info.profile} (${info.model}). Type /help for commands.`
        );
      })
      .catch(() => {
        addUserMessage("Connected. Type /help for commands.");
      });
  }, []);

  // Auto-scroll: reset offset when new messages arrive (if at bottom)
  useEffect(() => {
    if (scrollOffset === 0) {
      // already at bottom, stay there
    }
  }, [messages.length]);

  // Keyboard shortcuts
  useInput((_input, key) => {
    if (key.ctrl && _input === "c") {
      const now = Date.now();
      if (now - lastCtrlC < 2000) {
        app.exit();
      } else {
        setLastCtrlC(now);
      }
    }
    if (key.ctrl && _input === "l") {
      clearMessages();
    }
    if (key.pageUp) {
      setScrollOffset((prev) => Math.min(prev + 5, messages.length));
    }
    if (key.pageDown) {
      setScrollOffset((prev) => Math.max(prev - 5, 0));
    }
  });

  const isProcessing = messages.length > 0 && messages[messages.length - 1]?.isStreaming === true;
  const currentTurn = messages[messages.length - 1]?.turns ?? 1;

  const rows = process.stdout.rows ?? 24;
  const columns = process.stdout.columns ?? 80;
  // Reserve rows: health(1) + status(1) + input(1) + padding
  const chatHeight = Math.max(rows - 4, 5);

  const sendMessage = useCallback(
    (text: string) => {
      addUserMessage(text);
      fetch(`${host}/chat/message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message: text }),
      }).catch(() => {
        // silently handle send errors
      });
    },
    [addUserMessage]
  );

  return (
    <Box flexDirection="column" height={rows} width={columns}>
      <HealthBar health={health} />
      <Box flexGrow={1} overflow="hidden">
        <ChatView
          messages={messages}
          scrollOffset={scrollOffset}
          chatHeight={chatHeight}
          isProcessing={isProcessing}
          currentTurn={currentTurn}
        />
      </Box>
      <StatusBar
        connectionStatus={connectionStatus}
        profile={session.profile}
        model={session.model}
        contextPct={session.contextPct}
        tokens={session.tokens}
      />
      <Box>
        <Text dimColor>&gt; </Text>
        <Text>{"(InputBar placeholder - see Task 3)"}</Text>
      </Box>
    </Box>
  );
}
