import { describe, expect, test } from "bun:test";
import { parseHookInput } from "./hook-input";

describe("parseHookInput", () => {
  test("parses the documented fields", () => {
    const input = parseHookInput({
      session_id: "abc123",
      prompt_id: "550e8400",
      transcript_path: "/tmp/foo.jsonl",
      cwd: "/Users/x/project",
      permission_mode: "default",
      hook_event_name: "UserPromptSubmit",
    });
    expect(input).toEqual({ sessionId: "abc123", cwd: "/Users/x/project", hookEventName: "UserPromptSubmit" });
  });

  test("null/non-object input degrades gracefully, not a throw", () => {
    expect(parseHookInput(null)).toEqual({ sessionId: null, cwd: null, hookEventName: null });
    expect(parseHookInput("garbage")).toEqual({ sessionId: null, cwd: null, hookEventName: null });
  });

  test("missing fields individually degrade to null", () => {
    expect(parseHookInput({ session_id: "abc" })).toEqual({ sessionId: "abc", cwd: null, hookEventName: null });
  });
});
