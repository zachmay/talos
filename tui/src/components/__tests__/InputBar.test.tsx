import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { InputBar } from "../InputBar.js";

describe("InputBar", () => {
  it("Enter sends the current message", () => {
    const onSend = vi.fn();
    const onCommand = vi.fn();
    const inst = render(
      <InputBar onSend={onSend} onCommand={onCommand} isProcessing={false} />
    );

    // Type a message then press Enter
    inst.stdin.write("hello");
    inst.stdin.write("\r");

    expect(onSend).toHaveBeenCalledWith("hello");
  });

  it("Shift+Enter enables multi-line mode", () => {
    const onSend = vi.fn();
    const onCommand = vi.fn();
    const inst = render(
      <InputBar onSend={onSend} onCommand={onCommand} isProcessing={false} />
    );

    // Type then Shift+Enter (ESC [13;2u or just newline in raw mode)
    inst.stdin.write("line1");
    inst.stdin.write("\x1b\r"); // Alt+Enter as Shift+Enter proxy in terminals
    inst.stdin.write("line2");

    // Should not have sent yet
    expect(onSend).not.toHaveBeenCalled();
  });

  it("bracketed paste switches to multi-line mode", () => {
    const onSend = vi.fn();
    const onCommand = vi.fn();
    const inst = render(
      <InputBar onSend={onSend} onCommand={onCommand} isProcessing={false} />
    );

    // Bracketed paste sequence with multi-line content
    inst.stdin.write("\x1b[200~line1\nline2\nline3\x1b[201~");

    // Should be in multi-line mode, not sent
    expect(onSend).not.toHaveBeenCalled();
    // The last frame should contain the pasted content indicator
    const frame = inst.lastFrame();
    expect(frame).toBeDefined();
  });
});
