import { describe, expect, test } from "bun:test";
import { sessionIterationRecords, turnEditSignature, turnTestSignal } from "./signals";
import type { Entry, Session, Turn } from "../../adapters/claude-code/types";

/** Block shapes below mirror what was verified against real ~/.claude/projects JSONL on
 * 2026-07-16 (see signals.ts header) — tool_use input keys and the is_error/"Exit code N"
 * tool_result convention are real, not invented. */

function entryWithBlocks(uuid: string, kind: Entry["kind"], blocks: unknown[]): Entry {
  return {
    raw: { type: kind === "assistant-message" ? "assistant" : "user", message: { content: blocks } },
    lineNumber: 1,
    uuid,
    parentUuid: null,
    timestamp: new Date("2026-07-16T00:00:00Z"),
    kind,
  };
}

function makeTurn(turnId: string, entries: Entry[], startedAt: Date | null = new Date("2026-07-16T00:00:00Z")): Turn {
  return {
    turnId,
    turnIdSource: "prompt-id",
    startedAt,
    entries,
    model: "claude-haiku-4-5",
    modelRaw: "claude-haiku-4-5",
    modelValid: true,
    usage: null,
    content: { hasText: true, toolUseNames: [], toolResultCount: 0 },
  };
}

function makeSession(turns: Turn[]): Session {
  return {
    sessionId: "watch-test",
    filePath: "/fake.jsonl",
    ccVersions: ["2.1.999"],
    turns,
    modelSwitches: [],
    entryCount: turns.length,
    unknownTypeCounts: {},
    parseErrorCount: 0,
  };
}

const editBlock = (file: string, oldS: string, newS: string) => ({
  type: "tool_use",
  id: `tu-${file}-${oldS}`,
  name: "Edit",
  input: { file_path: file, old_string: oldS, new_string: newS, replace_all: false },
});

const bashBlock = (id: string, command: string) => ({ type: "tool_use", id, name: "Bash", input: { command } });

const resultBlock = (toolUseId: string, content: string, isError: boolean) => ({
  type: "tool_result",
  tool_use_id: toolUseId,
  content,
  is_error: isError,
});

describe("turnEditSignature", () => {
  test("captures Edit and Write inputs in order; identical edits give identical signatures", () => {
    const t1 = makeTurn("t1", [
      entryWithBlocks("a1", "assistant-message", [
        editBlock("src/x.ts", "foo", "bar"),
        { type: "tool_use", id: "w1", name: "Write", input: { file_path: "src/y.ts", content: "hello" } },
      ]),
    ]);
    const t2 = makeTurn("t2", [
      entryWithBlocks("a2", "assistant-message", [
        editBlock("src/x.ts", "foo", "bar"),
        { type: "tool_use", id: "w2", name: "Write", input: { file_path: "src/y.ts", content: "hello" } },
      ]),
    ]);
    expect(turnEditSignature(t1)).toContain("Edit src/x.ts");
    expect(turnEditSignature(t1)).toContain("Write src/y.ts");
    expect(turnEditSignature(t1)).toBe(turnEditSignature(t2));
  });

  test("a turn with no file-mutating tools has an EMPTY signature (same contract as an empty git diff)", () => {
    const t = makeTurn("t1", [
      entryWithBlocks("a1", "assistant-message", [bashBlock("b1", "ls"), { type: "text", text: "done" }]),
    ]);
    expect(turnEditSignature(t)).toBe("");
  });

  test("different edits give different signatures", () => {
    const t1 = makeTurn("t1", [entryWithBlocks("a1", "assistant-message", [editBlock("src/x.ts", "foo", "bar")])]);
    const t2 = makeTurn("t2", [entryWithBlocks("a2", "assistant-message", [editBlock("src/x.ts", "foo", "baz")])]);
    expect(turnEditSignature(t1)).not.toBe(turnEditSignature(t2));
  });
});

describe("turnTestSignal", () => {
  test("failing pattern-matched Bash: exit code parsed from the verified 'Exit code N' content shape", () => {
    const t = makeTurn("t1", [
      entryWithBlocks("a1", "assistant-message", [bashBlock("b1", "bun test")]),
      entryWithBlocks("u1", "tool-result", [resultBlock("b1", "Exit code 1\n3 tests failed:\nfoo.test.ts", true)]),
    ]);
    const signal = turnTestSignal(t, "bun test");
    expect(signal.exitCode).toBe(1);
    expect(signal.outputSignature).toContain("3 tests failed");
  });

  test("passing pattern-matched Bash: exit code 0", () => {
    const t = makeTurn("t1", [
      entryWithBlocks("a1", "assistant-message", [bashBlock("b1", "bun test")]),
      entryWithBlocks("u1", "tool-result", [resultBlock("b1", "All 10 tests passed", false)]),
    ]);
    expect(turnTestSignal(t, "bun test").exitCode).toBe(0);
  });

  test("is_error without an 'Exit code N' prefix (harness rejection shape) falls back to exit 1", () => {
    const t = makeTurn("t1", [
      entryWithBlocks("a1", "assistant-message", [bashBlock("b1", "bun test")]),
      entryWithBlocks("u1", "tool-result", [resultBlock("b1", "The user doesn't want to proceed", true)]),
    ]);
    expect(turnTestSignal(t, "bun test").exitCode).toBe(1);
  });

  test("no testPattern configured: null signal (repeated-error never trips) — documented, not guessed", () => {
    const t = makeTurn("t1", [
      entryWithBlocks("a1", "assistant-message", [bashBlock("b1", "bun test")]),
      entryWithBlocks("u1", "tool-result", [resultBlock("b1", "Exit code 1\nboom", true)]),
    ]);
    expect(turnTestSignal(t, undefined)).toEqual({ exitCode: null, outputSignature: null });
  });

  test("non-matching Bash commands are ignored; the LAST matching run in the turn wins", () => {
    const t = makeTurn("t1", [
      entryWithBlocks("a1", "assistant-message", [bashBlock("b1", "ls -la"), bashBlock("b2", "bun test"), bashBlock("b3", "bun test --watch")]),
      entryWithBlocks("u1", "tool-result", [
        resultBlock("b1", "Exit code 2\nirrelevant", true),
        resultBlock("b2", "Exit code 1\nfirst failure", true),
        resultBlock("b3", "All passed", false),
      ]),
    ]);
    expect(turnTestSignal(t, "bun test").exitCode).toBe(0);
  });
});

describe("sessionIterationRecords", () => {
  test("one record per turn, sinceMs filters out pre-watch history", () => {
    const oldTurn = makeTurn("t-old", [entryWithBlocks("a0", "assistant-message", [editBlock("a.ts", "x", "y")])], new Date("2026-07-15T00:00:00Z"));
    const newTurn = makeTurn("t-new", [entryWithBlocks("a1", "assistant-message", [editBlock("b.ts", "x", "y")])], new Date("2026-07-16T12:00:00Z"));
    const session = makeSession([oldTurn, newTurn]);

    const all = sessionIterationRecords(session, null, {});
    expect(all).toHaveLength(2);
    expect(all[0]!.commit).toBe("t-old");

    const sinceMs = new Date("2026-07-16T00:00:00Z").getTime();
    const filtered = sessionIterationRecords(session, sinceMs, {});
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.commit).toBe("t-new");
  });
});
