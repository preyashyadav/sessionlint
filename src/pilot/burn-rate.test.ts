import { describe, expect, test } from "bun:test";
import { estimateBurnRates } from "./burn-rate";

describe("estimateBurnRates", () => {
  test("fewer than 2 samples returns null — not enough data, not a fabricated rate", () => {
    expect(estimateBurnRates([])).toBeNull();
    expect(estimateBurnRates([{ timestamp: 1000, usedPercentage: 5 }])).toBeNull();
  });

  test("two samples produce equal recent and window-average estimates", () => {
    const estimates = estimateBurnRates([
      { timestamp: 0, usedPercentage: 0 },
      { timestamp: 60_000, usedPercentage: 10 },
    ]);
    expect(estimates).toHaveLength(2);
    for (const e of estimates!) {
      expect(e.percentPerMinute).toBeCloseTo(10);
    }
  });

  test("three samples: recent estimate reflects only the latest pair, window-average the full span", () => {
    const estimates = estimateBurnRates([
      { timestamp: 0, usedPercentage: 0 },
      { timestamp: 60_000, usedPercentage: 10 }, // 10%/min so far
      { timestamp: 120_000, usedPercentage: 40 }, // last minute burned 30%/min
    ]);
    const recent = estimates!.find((e) => e.basis === "recent")!;
    const windowAverage = estimates!.find((e) => e.basis === "window-average")!;
    expect(recent.percentPerMinute).toBeCloseTo(30);
    expect(windowAverage.percentPerMinute).toBeCloseTo(20); // 40% over 2 minutes
  });

  test("samples out of chronological order are sorted before computing", () => {
    const estimates = estimateBurnRates([
      { timestamp: 60_000, usedPercentage: 10 },
      { timestamp: 0, usedPercentage: 0 },
    ]);
    expect(estimates!.every((e) => e.percentPerMinute > 0)).toBe(true);
  });

  test("identical timestamps (same-ms samples) don't divide by zero", () => {
    const estimates = estimateBurnRates([
      { timestamp: 1000, usedPercentage: 5 },
      { timestamp: 1000, usedPercentage: 5 },
    ]);
    expect(estimates).toBeNull();
  });
});
