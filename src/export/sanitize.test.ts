/**
 * Redactor leak checks. All inputs are inline synthetic (fake names/paths/secrets),
 * proving the redactor strips PII/secrets/paths/file contents while preserving
 * structure, models, timestamps, and usage token counts.
 */

import { describe, expect, test } from "bun:test";
import { createSanitizer } from "./sanitize";

describe("createSanitizer: leak checks", () => {
  test("strips file content, absolute paths, and secrets from a normal turn", () => {
    const s = createSanitizer();
    const raw = JSON.stringify({
      type: "assistant",
      sessionId: "fake-session-1",
      version: "2.1.999",
      timestamp: "2026-01-01T00:00:00.000Z",
      cwd: "/Users/janedoe/Documents/acme-secret-project/src/billing.ts",
      gitBranch: "fix/acme-invoice-overcharge-ticket-4821",
      message: {
        model: "claude-sonnet-5",
        content: [
          { type: "text", text: "Here is the API key: sk-ant-fakeSecretValue1234567890abcdef" },
          { type: "tool_use", id: "toolu_01fake", name: "Read", input: { file_path: "/Users/janedoe/Documents/acme-secret-project/src/billing.ts" } },
        ],
        usage: { input_tokens: 123, output_tokens: 45 },
      },
    });

    const out = s.sanitizeLine(raw);
    expect(out).not.toContain("janedoe");
    expect(out).not.toContain("acme-secret-project");
    expect(out).not.toContain("billing.ts");
    expect(out).not.toContain("sk-ant-fakeSecretValue1234567890abcdef");
    expect(out).not.toContain("acme-invoice-overcharge");

    const parsed = JSON.parse(out);
    expect(parsed.message.model).toBe("claude-sonnet-5"); // preserved
    expect(parsed.timestamp).toBe("2026-01-01T00:00:00.000Z");
    expect(parsed.version).toBe("2.1.999");
    expect(parsed.message.usage.input_tokens).toBe(123);
    expect(parsed.message.usage.output_tokens).toBe(45);
    expect(parsed.message.content[1].name).toBe("Read");
    expect(parsed.gitBranch).toBe("main");
  });

  test("strips PII used as an object KEY, not just as a value", () => {
    const s = createSanitizer();
    const raw = JSON.stringify({
      type: "user",
      message: {
        content: {
          answers: {
            "What should the Team section include? Contributors: janedoe (jane@acme-corp.example).": "Just list them.",
          },
        },
      },
    });
    const out = s.sanitizeLine(raw);
    expect(out).not.toContain("janedoe");
    expect(out).not.toContain("jane@acme-corp.example");
    expect(out).not.toContain("acme-corp");
    const parsed = JSON.parse(out);
    const keys = Object.keys(parsed.message.content.answers);
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain(" ");
  });

  test("keeps distinct prose keys from colliding into the same placeholder", () => {
    const s = createSanitizer();
    const raw = JSON.stringify({
      type: "user",
      message: {
        content: {
          answers: {
            "This is the first long free-text question, with plenty of words.": "a1",
            "This is the second long free-text question, also with plenty of words.": "a2",
          },
        },
      },
    });
    const parsed = JSON.parse(s.sanitizeLine(raw));
    const answers = parsed.message.content.answers;
    expect(Object.keys(answers)).toHaveLength(2);
    expect(Object.values(answers).sort()).toEqual(["a1", "a2"]);
  });

  test("does not leak file paths used as object keys (e.g. trackedFileBackups)", () => {
    const s = createSanitizer();
    const raw = JSON.stringify({
      type: "file-history-snapshot",
      snapshot: {
        trackedFileBackups: {
          "/Users/janedoe/Documents/acme-secret-project/src/billing.ts": "full file content here",
          "/Users/janedoe/Documents/acme-secret-project/src/patients.ts": "other file content here",
        },
      },
    });
    const out = s.sanitizeLine(raw);
    expect(out).not.toContain("janedoe");
    expect(out).not.toContain("billing.ts");
    expect(out).not.toContain("patients.ts");
    expect(out).not.toContain("full file content here");
    const keys = Object.keys(JSON.parse(out).snapshot.trackedFileBackups);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
  });

  test("a dotted directory name does not leak its trailing text", () => {
    const s = createSanitizer();
    const raw = JSON.stringify({ cwd: "/Users/janedoe/Documents/myproject.0.0-secret-stable" });
    const out = s.sanitizeLine(raw);
    expect(out).not.toContain("secret-stable");
    expect(out).not.toContain("myproject");
  });

  test("multi-line JSONL: preserves line count and each line stays valid JSON", () => {
    const s = createSanitizer();
    const raw = [
      JSON.stringify({ type: "queue-operation", operation: "enqueue", timestamp: "t1" }),
      JSON.stringify({ type: "user", message: { role: "user", content: "hello there, a real question" } }),
      JSON.stringify({ type: "assistant", message: { model: "claude-opus-4-8", usage: { input_tokens: 9 } } }),
    ].join("\n");
    const lines = s.sanitizeJsonl(raw).split("\n").filter((l) => l.trim());
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });
});
