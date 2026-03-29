import { describe, it, expect } from "vitest";
import { parseSSELines } from "../lib/sse-parser.js";

describe("parseSSELines", () => {
  it("parses single event with explicit type", () => {
    const lines = ["event: token", 'data: {"text":"hello"}', ""];
    const events = parseSSELines(lines);
    expect(events).toEqual([{ type: "token", data: '{"text":"hello"}' }]);
  });

  it("parses event with default type 'message' when no event: line", () => {
    const lines = ['data: {"text":"world"}', ""];
    const events = parseSSELines(lines);
    expect(events).toEqual([{ type: "message", data: '{"text":"world"}' }]);
  });

  it("parses multiple events from single chunk", () => {
    const lines = [
      "event: thinking",
      'data: {"text":"hmm"}',
      "",
      "event: token",
      'data: {"text":"hi"}',
      "",
    ];
    const events = parseSSELines(lines);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: "thinking", data: '{"text":"hmm"}' });
    expect(events[1]).toEqual({ type: "token", data: '{"text":"hi"}' });
  });

  it("handles eventType reset between events", () => {
    const lines = [
      "event: done",
      'data: {"result":{}}',
      "",
      'data: {"text":"next"}',
      "",
    ];
    const events = parseSSELines(lines);
    expect(events[0]!.type).toBe("done");
    expect(events[1]!.type).toBe("message");
  });
});
