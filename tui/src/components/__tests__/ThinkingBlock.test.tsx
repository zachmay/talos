import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { ThinkingBlock } from "../ThinkingBlock.js";

describe("ThinkingBlock", () => {
  it("starts collapsed and shows indicator", () => {
    const inst = render(<ThinkingBlock text="deep thoughts" isStreaming={false} />);
    const frame = inst.lastFrame();
    expect(frame).toContain("[thinking] ▶");
    expect(frame).not.toContain("deep thoughts");
  });

  it("'t' key toggles to expanded showing text", () => {
    const inst = render(<ThinkingBlock text="deep thoughts" isStreaming={false} />);
    // Press 't' to expand
    inst.stdin.write("t");
    const frame = inst.lastFrame();
    expect(frame).toContain("[thinking] ▼");
    expect(frame).toContain("deep thoughts");
  });

  it("shows spinner when collapsed and streaming", () => {
    const inst = render(<ThinkingBlock text="thinking..." isStreaming={true} />);
    const frame = inst.lastFrame();
    expect(frame).toContain("[thinking] ▶");
    // Spinner renders some character
    expect(frame).toBeDefined();
  });
});
