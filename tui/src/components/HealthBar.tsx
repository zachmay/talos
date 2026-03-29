import React from "react";
import { Box, Text } from "ink";
import type { HealthStatus } from "../../../shared/types.js";

interface HealthBarProps {
  health: HealthStatus | null;
}

function Dot({ ok }: { ok: boolean | null }) {
  if (ok === null) return <Text color="gray">●</Text>;
  return ok ? <Text color="green">●</Text> : <Text color="red">●</Text>;
}

export function HealthBar({ health }: HealthBarProps) {
  return (
    <Box>
      <Text dimColor>  DB </Text><Dot ok={health?.db ?? null} />
      <Text dimColor>  MCP </Text><Dot ok={health?.mcp ?? null} />
      <Text dimColor>  LLM </Text><Dot ok={health?.llm ?? null} />
      <Text dimColor>  Embed </Text><Dot ok={health?.embed ?? null} />
    </Box>
  );
}
