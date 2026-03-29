import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";

interface ThinkingBlockProps {
  text: string;
  isStreaming: boolean;
}

export function ThinkingBlock({ text, isStreaming }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);

  useInput((input) => {
    if (input === "t") {
      setExpanded((prev) => !prev);
    }
  });

  if (expanded) {
    return (
      <Box flexDirection="column" marginLeft={2}>
        <Text dimColor>[thinking] ▼</Text>
        <Text dimColor>{text}</Text>
      </Box>
    );
  }

  return (
    <Box marginLeft={2}>
      <Text dimColor>[thinking] ▶ </Text>
      {isStreaming && <Spinner type="dots" />}
    </Box>
  );
}
