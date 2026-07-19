import { describe, expect, test } from "bun:test";
import { renderMorningReport } from "./render";
import type { RunLog } from "./types";

function baseRunLog(overrides: Partial<RunLog> = {}): RunLog {
  return {
    runStartedAt: "2026-07-13T04:00:00.000Z",
    runEndedAt: "2026-07-13T09:12:00.000Z",
    projectDir: "/home/dev/myproject",
    command: ["bash", "ralph-loop.sh"],
    budgetUsd: null,
    perIterBudgetUsd: null,
    maxIters: 50,
    stopReason: "watchdog:identical-diffs",
    exitCode: null,
    totalCostUsd: 0.75,
    iterations: [
      { index: 1, commit: "aaaaaaaa1111", costUsd: 0.25, linesAdded: 12, linesRemoved: 3, testExitCode: null, wasted: false, wasteReason: null },
      { index: 2, commit: "bbbbbbbb2222", costUsd: 0.25, linesAdded: 12, linesRemoved: 3, testExitCode: null, wasted: true, wasteReason: "identical-diff" },
      { index: 3, commit: "cccccccc3333", costUsd: 0.25, linesAdded: 12, linesRemoved: 3, testExitCode: null, wasted: true, wasteReason: "identical-diff" },
    ],
    watchdogSavings: { lowUsd: 1.6, highUsd: 2.4 },
    ...overrides,
  };
}

describe("renderMorningReport (golden file)", () => {
  test("full report with a watchdog trip and waste", () => {
    const rendered = renderMorningReport(baseRunLog());
    expect(rendered).toBe(
      [
        "sessionlint report — morning-after summary",
        "Run: 2026-07-13T04:00:00.000Z -> 2026-07-13T09:12:00.000Z",
        "Project: /home/dev/myproject",
        "Command: bash ralph-loop.sh",
        "Stopped: watchdog:identical-diffs",
        "",
        "Iteration timeline:",
        "  #1  aaaaaaaa  $0.25  +12/-3  ok",
        "  #2  bbbbbbbb  $0.25  +12/-3  wasted (identical-diff)",
        "  #3  cccccccc  $0.25  +12/-3  wasted (identical-diff)",
        "",
        "Waste breakdown: 2 of 3 iteration(s) wasted ($0.50 of $0.75 total)",
        "Watchdog saved an estimated $1.60-$2.40 by stopping here instead of continuing to the configured budget/max-iters limit.",
      ].join("\n")
    );
  });

  test("a clean run (no waste, no watchdog trip) omits the savings line", () => {
    const runLog = baseRunLog({
      stopReason: "max-iters",
      watchdogSavings: null,
      iterations: [
        { index: 1, commit: "aaaaaaaa1111", costUsd: 0.25, linesAdded: 12, linesRemoved: 3, testExitCode: 0, wasted: false, wasteReason: null },
      ],
      totalCostUsd: 0.25,
    });
    const rendered = renderMorningReport(runLog);
    expect(rendered).not.toContain("Watchdog saved");
    expect(rendered).toContain("Waste breakdown: 0 of 1 iteration(s) wasted ($0.00 of $0.25 total)");
  });

  test("a run with zero iterations reports that plainly instead of an empty table", () => {
    const rendered = renderMorningReport(baseRunLog({ iterations: [], watchdogSavings: null }));
    expect(rendered).toContain("No iterations (commits) were detected during this run.");
    expect(rendered).not.toContain("Iteration timeline:");
  });

  test("an iteration with unknown cost data renders 'cost unknown' rather than $0.00", () => {
    const runLog = baseRunLog({
      totalCostUsd: null,
      watchdogSavings: null,
      iterations: [
        { index: 1, commit: "aaaaaaaa1111", costUsd: null, linesAdded: 5, linesRemoved: 0, testExitCode: null, wasted: false, wasteReason: null },
      ],
    });
    const rendered = renderMorningReport(runLog);
    expect(rendered).toContain("cost unknown");
    expect(rendered).toContain("Waste breakdown: 0 of 1 iteration(s) wasted");
    expect(rendered).not.toContain("of $"); // no total-cost parenthetical when totalCostUsd is null
  });
});
