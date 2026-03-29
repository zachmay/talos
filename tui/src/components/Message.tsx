import React from "react";
import { Box, Text } from "ink";
import { renderMarkdown } from "../lib/markdown.js";
import { ThinkingBlock } from "./ThinkingBlock.js";
import { ToolBadge } from "./ToolBadge.js";
import type { ChatMessage } from "../hooks/useChat.js";

interface MessageProps {
  message: ChatMessage;
}

function formatRelative(date: Date): string {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function Message({ message }: MessageProps) {
  const { role, text, thinking, tools, timestamp, isStreaming, turns, tokens } = message;
  const label = role === "user"
    ? <Text color="green" bold>You: </Text>
    : <Text color="blue" bold>Agent: </Text>;

  const rendered = text ? renderMarkdown(text).trimEnd() : "";

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        {label}
        <Text dimColor>{formatRelative(timestamp)}</Text>
      </Box>
      {rendered && <Text>{rendered}</Text>}
      {thinking && <ThinkingBlock text={thinking} isStreaming={isStreaming} />}
      {tools.map((tool, i) => (
        <ToolBadge
          key={i}
          name={tool.name}
          input={tool.input}
          result={tool.result}
          isStreaming={isStreaming && i === tools.length - 1 && !tool.result}
        />
      ))}
      {role === "agent" && !isStreaming && turns != null && tokens != null && (
        <Text dimColor>({turns} turns, {tokens} tokens)</Text>
      )}
    </Box>
  );
}
