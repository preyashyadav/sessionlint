import { describe, expect, test } from "bun:test";
import {
  detectIdenticalDiffs,
  detectNoNewCommits,
  detectOscillation,
  detectRepeatedError,
  evaluateWatchdog,
} from "./detectors";
import type { IterationRecord, WatchdogConfig } from "./types";

const config: WatchdogConfig = { noProgressPolls: 3, identicalDiffIters: 3, repeatedErrorIters: 3 };

function record(overrides: Partial<IterationRecord> = {}): IterationRecord {
  return { commit: "c", diffText: "diff", testExitCode: null, testOutputSignature: null, ...overrides };
}

describe("detectNoNewCommits", () => {
  test("trips at or past the configured poll threshold", () => {
    expect(detectNoNewCommits(2, config)).toBe(false);
    expect(detectNoNewCommits(3, config)).toBe(true);
    expect(detectNoNewCommits(4, config)).toBe(true);
  });
});

describe("detectIdenticalDiffs", () => {
  test("does not trip with fewer iterations than the threshold", () => {
    expect(detectIdenticalDiffs([record({ diffText: "x" }), record({ diffText: "x" })], config)).toBe(false);
  });

  test("trips when the last N diffs are byte-identical and non-empty", () => {
    const history = [record({ diffText: "same" }), record({ diffText: "same" }), record({ diffText: "same" })];
    expect(detectIdenticalDiffs(history, config)).toBe(true);
  });

  test("does not trip on identical EMPTY diffs — that's 'no changes,' a different situation", () => {
    const history = [record({ diffText: "" }), record({ diffText: "" }), record({ diffText: "" })];
    expect(detectIdenticalDiffs(history, config)).toBe(false);
  });

  test("does not trip when diffs differ", () => {
    const history = [record({ diffText: "a" }), record({ diffText: "b" }), record({ diffText: "c" })];
    expect(detectIdenticalDiffs(history, config)).toBe(false);
  });
});

describe("detectOscillation", () => {
  test("trips on an A -> B -> A diff pattern", () => {
    const history = [record({ diffText: "A" }), record({ diffText: "B" }), record({ diffText: "A" })];
    expect(detectOscillation(history)).toBe(true);
  });

  test("does not trip on A -> B -> C", () => {
    const history = [record({ diffText: "A" }), record({ diffText: "B" }), record({ diffText: "C" })];
    expect(detectOscillation(history)).toBe(false);
  });

  test("does not trip on empty diffs even if they repeat in the A/B/A position", () => {
    const history = [record({ diffText: "" }), record({ diffText: "B" }), record({ diffText: "" })];
    expect(detectOscillation(history)).toBe(false);
  });

  test("needs at least 3 iterations of history", () => {
    expect(detectOscillation([record(), record()])).toBe(false);
  });
});

describe("detectRepeatedError", () => {
  test("trips when the same failing signature repeats N times", () => {
    const history = Array.from({ length: 3 }, () => record({ testExitCode: 1, testOutputSignature: "AssertionError: x" }));
    expect(detectRepeatedError(history, config)).toBe(true);
  });

  test("does not trip when the failure signature changes each time", () => {
    const history = [
      record({ testExitCode: 1, testOutputSignature: "error A" }),
      record({ testExitCode: 1, testOutputSignature: "error B" }),
      record({ testExitCode: 1, testOutputSignature: "error C" }),
    ];
    expect(detectRepeatedError(history, config)).toBe(false);
  });

  test("does not trip when a run in the middle actually passed", () => {
    const history = [
      record({ testExitCode: 1, testOutputSignature: "same" }),
      record({ testExitCode: 0, testOutputSignature: "same" }),
      record({ testExitCode: 1, testOutputSignature: "same" }),
    ];
    expect(detectRepeatedError(history, config)).toBe(false);
  });

  test("no --test-command configured (testExitCode always null) never trips", () => {
    const history = Array.from({ length: 3 }, () => record({ testExitCode: null, testOutputSignature: null }));
    expect(detectRepeatedError(history, config)).toBe(false);
  });
});

describe("evaluateWatchdog", () => {
  test("no signal at all returns null", () => {
    expect(evaluateWatchdog([record()], 0, config)).toBeNull();
  });

  test("no-new-commits takes priority over other signals when both are present", () => {
    const history = Array.from({ length: 3 }, () => record({ diffText: "same" }));
    expect(evaluateWatchdog(history, 5, config)).toBe("no-new-commits");
  });
});
