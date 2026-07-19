import { describe, expect, test } from "bun:test";
import { estimateWatchdogSavings } from "./savings";
import type { IterationReportEntry } from "./types";

function iter(costUsd: number | null): IterationReportEntry {
  return { index: 1, commit: "c", costUsd, linesAdded: 0, linesRemoved: 0, testExitCode: null, wasted: false, wasteReason: null };
}

describe("estimateWatchdogSavings", () => {
  test("no cost data at all returns null — never a guessed number", () => {
    expect(estimateWatchdogSavings([iter(null), iter(null)], null, 10, 5)).toBeNull();
  });

  test("neither --budget nor --max-iters configured returns null — no defined headroom to project", () => {
    expect(estimateWatchdogSavings([iter(0.1), iter(0.1)], 0.2, null, null)).toBeNull();
  });

  test("already at or past max-iters returns null (no remaining headroom)", () => {
    expect(estimateWatchdogSavings([iter(0.1), iter(0.1)], 0.2, null, 2)).toBeNull();
  });

  test("max-iters headroom produces a real low < high range", () => {
    const result = estimateWatchdogSavings([iter(0.1), iter(0.1), iter(0.1)], 0.3, null, 10);
    expect(result).not.toBeNull();
    expect(result!.lowUsd).toBeLessThan(result!.highUsd);
    expect(result!.lowUsd).toBeGreaterThan(0);
  });

  test("budget headroom (no max-iters) also produces a real low < high range", () => {
    const result = estimateWatchdogSavings([iter(0.5), iter(0.5)], 1.0, 5.0, null);
    expect(result).not.toBeNull();
    expect(result!.lowUsd).toBeLessThan(result!.highUsd);
  });

  test("degenerate case: identical recent and overall rates still produce low < high, never a point", () => {
    const result = estimateWatchdogSavings([iter(0.2), iter(0.2), iter(0.2)], 0.6, null, 10);
    expect(result).not.toBeNull();
    expect(result!.lowUsd).toBeLessThan(result!.highUsd);
  });

  test("all-zero-cost iterations return null (no positive rate to project)", () => {
    expect(estimateWatchdogSavings([iter(0), iter(0)], 0, null, 10)).toBeNull();
  });
});
