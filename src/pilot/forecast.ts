/**
 * Phase 3 Task 2: turns burn-rate estimates into a forecast BAND, never a
 * point estimate (D-004) — projecting future usage is inherently uncertain
 * even from a single rate estimate, so a fixed uncertainty margin is applied
 * on top of the recent/window-average disagreement, not just as an edge-case
 * patch for when the two estimates happen to agree.
 */

import type { BurnRateEstimate, ForecastBand } from "./types";

const UNCERTAINTY_MARGIN = 0.2;

/** Null means "no positive burn observed" — the window isn't heading toward full. */
export function forecastWallMinutes(
  remainingPercentage: number,
  minutesToReset: number,
  estimates: BurnRateEstimate[]
): ForecastBand | null {
  const positiveRates = estimates.filter((e) => e.percentPerMinute > 0);
  if (positiveRates.length === 0) return null;

  const projections = positiveRates.map((e) => Math.min(remainingPercentage / e.percentPerMinute, minutesToReset));
  const bounds = projections.flatMap((p) => [p * (1 - UNCERTAINTY_MARGIN), p * (1 + UNCERTAINTY_MARGIN)]);

  const low = Math.max(0, Math.round(Math.min(...bounds)));
  const highRaw = Math.min(minutesToReset, Math.max(...bounds));
  const high = Math.max(Math.round(highRaw), low + 1);

  return { lowMinutes: low, highMinutes: high };
}
