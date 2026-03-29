import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { ToolBadge } from "../ToolBadge.js";

describe("ToolBadge", () => {
  it("collapsed shows truncated result at 60 chars", () => {
    const longResult = "a".repeat(100);
    const inst = render(
      <ToolBadge
        name="search"
        input={{ query: "test" }}
        result={longResult}
        isStreaming={false}
      />
    );
    const frame = inst.lastFrame();
    expect(frame).toContain("search");
    expect(frame).toContain("test");
    // Should contain truncated result (60 chars + ...)
    expect(frame).toContain("a".repeat(60) + "...");
    expect(frame).not.toContain("a".repeat(100));
  });

  it("Enter toggles expanded state showing full result", () => {
    const result = "full result text here";
    const inst = render(
      <ToolBadge
        name="search"
        input={{ query: "test query" }}
        result={result}
        isStreaming={false}
      />
    );

    // Press Enter to expand
    inst.stdin.write("\r");
    const frame = inst.lastFrame();
    expect(frame).toContain("Result: " + result);
  });
});
