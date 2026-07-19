import { describe, expect, test } from "bun:test";
import { generateUserPromptSubmitHookConfig } from "./hook-config";

describe("generateUserPromptSubmitHookConfig", () => {
  test("targets exactly UserPromptSubmit — the structural guarantee against mid-turn firing", () => {
    const config = generateUserPromptSubmitHookConfig("/path/to/hook");
    expect(Object.keys(config.hooks)).toEqual(["UserPromptSubmit"]);
  });

  test("uses type 'command' with the given command path and a bounded timeout", () => {
    const config = generateUserPromptSubmitHookConfig("/path/to/hook");
    const entry = config.hooks.UserPromptSubmit[0]!.hooks[0]!;
    expect(entry.type).toBe("command");
    expect(entry.command).toBe("/path/to/hook");
    expect(entry.timeout).toBeGreaterThan(0);
    expect(entry.timeout).toBeLessThanOrEqual(30); // UserPromptSubmit's own default cap, per Claude Code docs
  });

  test("empty matcher fires on every UserPromptSubmit occurrence", () => {
    const config = generateUserPromptSubmitHookConfig("/path/to/hook");
    expect(config.hooks.UserPromptSubmit[0]!.matcher).toBe("");
  });
});
