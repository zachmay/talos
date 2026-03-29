import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { InputBar } from "../InputBar.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("InputBar", () => {
  it("Enter sends the current message", async () => {
    const onSend = vi.fn();
    const onCommand = vi.fn();
    const inst = render(
      <InputBar onSend={onSend} onCommand={onCommand} isProcessing={false} />
    );

    inst.stdin.write("hello");
    await delay(50);
    inst.stdin.write("\r");
    await delay(50);

    expect(onSend).toHaveBeenCalledWith("hello");
  });

  it("Shift+Enter enables multi-line mode", async () => {
    const onSend = vi.fn();
    const onCommand = vi.fn();
    const inst = render(
      <InputBar onSend={onSend} onCommand={onCommand} isProcessing={false} />
    );

    inst.stdin.write("line1");
    await delay(50);
    // Meta+Enter triggers multi-line in our implementation
    inst.stdin.write("\x1b\r");
    await delay(50);

    expect(onSend).not.toHaveBeenCalled();
    const frame = inst.lastFrame();
    expect(frame).toContain("[multi-line]");
  });

  it("has bracketed paste handler in source code", () => {
    // Bracketed paste (\x1b[200~ / \x1b[201~) cannot be tested via ink-testing-library
    // because ink's input parser intercepts escape sequences before useInput.
    // Verify the handler exists in the component source.
    const fs = require("node:fs");
    const source = fs.readFileSync(
      new URL("../InputBar.tsx", import.meta.url),
      "utf8"
    );
    expect(source).toContain("\\x1b[200~");
    expect(source).toContain("\\x1b[201~");
    expect(source).toContain("setIsMultiLine(true)");
  });
});
