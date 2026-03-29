import React, { useState, useCallback } from "react";
import { Box, Text, useInput, useApp } from "ink";

interface InputBarProps {
  onSend: (text: string) => void;
  onCommand: (cmd: string, args: string) => void;
  isProcessing: boolean;
}

const SLASH_COMMANDS = [
  "/quit",
  "/clear",
  "/status",
  "/help",
  "/reconnect",
  "/skills",
  "/history",
  "/btw",
];

export function InputBar({ onSend, onCommand, isProcessing }: InputBarProps) {
  const app = useApp();
  const [value, setValue] = useState("");
  const [isMultiLine, setIsMultiLine] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [pasteBuffer, setPasteBuffer] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);

  useInput((input, key) => {
    // Bracketed paste detection
    if (input.includes("\x1b[200~") || pasteBuffer !== null) {
      let text = pasteBuffer !== null ? pasteBuffer + input : input;

      // Remove paste start sequence
      text = text.replace("\x1b[200~", "");

      if (text.includes("\x1b[201~")) {
        // Paste end found
        text = text.replace("\x1b[201~", "");
        setPasteBuffer(null);
        if (text.includes("\n")) {
          setIsMultiLine(true);
        }
        setValue((prev) => prev + text);
      } else {
        // Still pasting
        setPasteBuffer(text);
      }
      return;
    }

    // Tab: show slash command suggestions
    if (key.tab) {
      if (value.startsWith("/")) {
        setShowSuggestions(true);
      }
      return;
    }

    // Enter: send message or command
    if (key.return && !key.shift && !key.meta) {
      if (!value.trim()) return;
      if (value.startsWith("/")) {
        const spaceIdx = value.indexOf(" ");
        const cmd = spaceIdx > 0 ? value.slice(0, spaceIdx) : value;
        const args = spaceIdx > 0 ? value.slice(spaceIdx + 1) : "";
        handleCommand(cmd, args);
      } else {
        onSend(value);
        setHistory((prev) => [...prev, value]);
        if (isProcessing) setQueued(true);
      }
      setValue("");
      setIsMultiLine(false);
      setHistoryIndex(-1);
      setShowSuggestions(false);
      return;
    }

    // Shift+Enter or Meta+Enter: newline
    if (key.return && (key.shift || key.meta)) {
      setValue((prev) => prev + "\n");
      setIsMultiLine(true);
      return;
    }

    // Escape: collapse multi-line
    if (key.escape) {
      setIsMultiLine(false);
      setShowSuggestions(false);
      return;
    }

    // Up arrow: history navigation
    if (key.upArrow && history.length > 0) {
      const newIdx =
        historyIndex < 0
          ? history.length - 1
          : Math.max(0, historyIndex - 1);
      setHistoryIndex(newIdx);
      setValue(history[newIdx]!);
      return;
    }

    // Down arrow: history navigation
    if (key.downArrow && historyIndex >= 0) {
      const newIdx = historyIndex + 1;
      if (newIdx >= history.length) {
        setHistoryIndex(-1);
        setValue("");
      } else {
        setHistoryIndex(newIdx);
        setValue(history[newIdx]!);
      }
      return;
    }

    // Backspace
    if (key.backspace || key.delete) {
      setValue((prev) => prev.slice(0, -1));
      return;
    }

    // Regular input
    if (input && !key.ctrl && !key.meta) {
      setValue((prev) => prev + input);
      setShowSuggestions(false);
    }
  });

  const handleCommand = useCallback(
    (cmd: string, args: string) => {
      switch (cmd) {
        case "/quit":
          app.exit();
          break;
        default:
          onCommand(cmd, args);
          break;
      }
    },
    [app, onCommand]
  );

  const suggestions = showSuggestions
    ? SLASH_COMMANDS.filter((c) => c.startsWith(value))
    : [];

  return (
    <Box flexDirection="column">
      {suggestions.length > 0 && (
        <Box flexDirection="column" marginLeft={2}>
          {suggestions.map((s) => (
            <Text key={s} dimColor>
              {s}
            </Text>
          ))}
        </Box>
      )}
      <Box>
        <Text dimColor>&gt; </Text>
        <Text>{value || ""}</Text>
        {isMultiLine && <Text dimColor> [multi-line]</Text>}
        {queued && isProcessing && (
          <Text dimColor> Queued (agent processing)</Text>
        )}
      </Box>
    </Box>
  );
}
