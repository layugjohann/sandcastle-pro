import { describe, expect, it } from "vitest";
import { resultUsage } from "../src/sandcastle-agent.js";

describe("resultUsage", () => {
  it("reads the session total from Claude's result line, not one message's usage", () => {
    // Shape of a real `claude -p --output-format stream-json` result line, trimmed.
    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      num_turns: 3,
      usage: { input_tokens: 4, output_tokens: 246, cache_creation_input_tokens: 14129, cache_read_input_tokens: 30042 },
    });
    expect(resultUsage(line)).toEqual({ inputTokens: 4, outputTokens: 246, cacheCreationTokens: 14129, cacheReadTokens: 30042 });
  });

  it("ignores assistant lines, other output and result lines without usage", () => {
    const assistant = JSON.stringify({ type: "assistant", message: { usage: { input_tokens: 2, output_tokens: 17 } } });
    expect(resultUsage(assistant)).toBeUndefined();
    expect(resultUsage("plain text")).toBeUndefined();
    expect(resultUsage('{"type":"result"')).toBeUndefined();
    expect(resultUsage(JSON.stringify({ type: "result", is_error: true }))).toBeUndefined();
  });
});
