import { describe, expect, test } from "bun:test";
import { renderLoopResult } from "./render";
import type { LoopResult } from "./types";

function result(overrides: Partial<LoopResult> = {}): LoopResult {
  return {
    exitCode: 0,
    signalCode: null,
    stopReason: null,
    iterationsCompleted: 0,
    handoffNoteWritten: false,
    notified: false,
    runLogPath: null,
    ...overrides,
  };
}

describe("renderLoopResult", () => {
  test("a natural exit reports the exit code, not a stop reason", () => {
    const rendered = renderLoopResult(result({ exitCode: 0, iterationsCompleted: 3 }));
    expect(rendered).toContain("3 iteration(s)");
    expect(rendered).toContain("Child exited on its own (exit code 0)");
  });

  test("a budget stop reports the reason and a handoff note if written", () => {
    const rendered = renderLoopResult(result({ stopReason: "overall-budget", handoffNoteWritten: true }));
    expect(rendered).toContain("Stopped by sessionlint: overall-budget");
    expect(rendered).toContain("Handoff note appended");
  });

  test("a watchdog trip mentions notification status", () => {
    const notified = renderLoopResult(result({ stopReason: "watchdog:oscillation", notified: true }));
    expect(notified).toContain("Desktop notification sent.");

    const notNotified = renderLoopResult(result({ stopReason: "watchdog:oscillation", notified: false }));
    expect(notNotified).toContain("Desktop notification not sent");
  });

  test("a non-watchdog stop never mentions notification at all", () => {
    const rendered = renderLoopResult(result({ stopReason: "max-iters" }));
    expect(rendered).not.toContain("notification");
  });

  test("a persisted run log points to `sessionlint report --last`", () => {
    const rendered = renderLoopResult(result({ runLogPath: "/tmp/proj/.sessionlint/loop-runs/x.json" }));
    expect(rendered).toContain("/tmp/proj/.sessionlint/loop-runs/x.json");
    expect(rendered).toContain("sessionlint report --last");
  });

  test("no run log written means no run-log line at all", () => {
    const rendered = renderLoopResult(result({ runLogPath: null }));
    expect(rendered).not.toContain("Run log");
  });
});
