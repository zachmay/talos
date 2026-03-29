import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";

interface ToolBadgeProps {
  name: string;
  input: Record<string, unknown>;
  result?: string;
  isStreaming: boolean;
}

export function ToolBadge({ name, input, result, isStreaming }: ToolBadgeProps) {
  const [expanded, setExpanded] = useState(false);

  useInput((_input, key) => {
    if (key.return) {
      setExpanded((prev) => !prev);
    }
  });

  const firstParam = Object.values(input)[0];
  const paramStr = typeof firstParam === "string" ? firstParam : JSON.stringify(firstParam ?? "");
  const truncatedParam = paramStr.length > 40 ? paramStr.slice(0, 40) + "..." : paramStr;

  const resultSummary = result
    ? result.length > 60 ? result.slice(0, 60) + "..." : result
    : isStreaming ? "" : "...";

  if (expanded) {
    return (
      <Box flexDirection="column" marginLeft={2}>
        <Text color="cyan">&gt; {name} &quot;{truncatedParam}&quot;</Text>
        <Text dimColor>  Input: {JSON.stringify(input, null, 2)}</Text>
        {result && <Text dimColor>  Result: {result}</Text>}
        {isStreaming && !result && <Box marginLeft={2}><Spinner type="dots" /></Box>}
      </Box>
    );
  }

  return (
    <Box marginLeft={2}>
      <Text color="cyan">&gt; {name} &quot;{truncatedParam}&quot;</Text>
      {result && <Text dimColor> → {resultSummary}</Text>}
      {isStreaming && !result && <Box marginLeft={1}><Spinner type="dots" /></Box>}
    </Box>
  );
}
