import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { Message } from "./Message.js";
import type { ChatMessage } from "../hooks/useChat.js";

interface ChatViewProps {
  messages: ChatMessage[];
  scrollOffset: number;
  chatHeight: number;
  isProcessing: boolean;
  currentTurn: number;
}

export function ChatView({ messages, scrollOffset, chatHeight, isProcessing, currentTurn }: ChatViewProps) {
  // Simple slice-based scrolling: show messages from end minus offset
  const endIdx = messages.length - scrollOffset;
  const startIdx = Math.max(0, endIdx - chatHeight);
  const visible = messages.slice(startIdx, endIdx > 0 ? endIdx : messages.length);

  return (
    <Box flexDirection="column" overflow="hidden">
      {visible.map((msg) => (
        <Message key={msg.id} message={msg} />
      ))}
      {isProcessing && (
        <Box marginLeft={2}>
          <Spinner type="dots" />
          <Text> Processing... (turn {currentTurn})</Text>
        </Box>
      )}
      {scrollOffset > 0 && (
        <Box justifyContent="center">
          <Text dimColor>New messages below ↓</Text>
        </Box>
      )}
    </Box>
  );
}
