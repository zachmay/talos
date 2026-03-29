import React from "react";
import { Box, Text } from "ink";
import type { ConnectionStatus } from "../hooks/useSSE.js";

interface StatusBarProps {
  connectionStatus: ConnectionStatus;
  profile: string;
  model: string;
  contextPct: number;
  tokens: number;
}

function connectionDot(status: ConnectionStatus) {
  switch (status) {
    case "connected": return <Text color="green">●</Text>;
    case "reconnecting": return <Text color="yellow">●</Text>;
    case "disconnected": return <Text color="red">●</Text>;
  }
}

function miniBar(pct: number): string {
  const filled = Math.round((pct / 100) * 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

function barColor(pct: number): string {
  if (pct < 50) return "green";
  if (pct < 70) return "yellow";
  if (pct < 85) return "#FFA500";
  return "red";
}

export function StatusBar({ connectionStatus, profile, model, contextPct, tokens }: StatusBarProps) {
  return (
    <Box>
      <Text> </Text>
      {connectionDot(connectionStatus)}
      <Text> {profile} · {model} · </Text>
      <Text color={barColor(contextPct)}>[{miniBar(contextPct)}]</Text>
      <Text> {contextPct}% · {tokens}tok</Text>
    </Box>
  );
}
