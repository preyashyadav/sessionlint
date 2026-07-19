import { describe, expect, test } from "bun:test";
import { forecastWallMinutes } from "./forecast";
import type { BurnRateEstimate } from "./types";

describe("forecastWallMinutes", () => {
  test("D-004: the band is always a real range (high > low), never a collapsed point", () => {
    // Two estimates that happen to agree exactly — the degenerate case a naive
    // "low = min(projections), high = max(projections)" implementation would
    // collapse to a single number.
    const equalEstimates: BurnRateEstimate[] = [
      { percentPerMinute: 2, basis: "recent" },
      { percentPerMinute: 2, basis: "window-average" },
    ];
    const band = forecastWallMinutes(50, 1000, equalEstimates);
    expect(band).not.toBeNull();
    expect(band!.highMinutes).toBeGreaterThan(band!.lowMinutes);
  });

  test("disagreeing estimates widen the band accordingly", () => {
    const estimates: BurnRateEstimate[] = [
      { percentPerMinute: 1, basis: "window-average" },
      { percentPerMinute: 5, basis: "recent" },
    ];
    const band = forecastWallMinutes(50, 1000, estimates);
    // slow estimate (1%/min) projects ~50min, fast estimate (5%/min) projects ~10min
    expect(band!.lowMinutes).toBeLessThan(15);
    expect(band!.highMinutes).toBeGreaterThan(40);
  });

  test("no positive burn observed returns null — not a fabricated 'never' forecast", () => {
    expect(forecastWallMinutes(50, 1000, [{ percentPerMinute: 0, basis: "recent" }])).toBeNull();
    expect(forecastWallMinutes(50, 1000, [{ percentPerMinute: -1, basis: "recent" }])).toBeNull();
  });

  test("projection is capped at minutesToReset — can't burn past a window that already reset", () => {
    const estimates: BurnRateEstimate[] = [{ percentPerMinute: 0.01, basis: "recent" }];
    const band = forecastWallMinutes(90, 30, estimates);
    expect(band!.highMinutes).toBeLessThanOrEqual(31); // capped near minutesToReset, plus rounding
  });

  test("low bound never goes negative", () => {
    const estimates: BurnRateEstimate[] = [{ percentPerMinute: 1000, basis: "recent" }];
    const band = forecastWallMinutes(1, 1000, estimates);
    expect(band!.lowMinutes).toBeGreaterThanOrEqual(0);
  });
});
