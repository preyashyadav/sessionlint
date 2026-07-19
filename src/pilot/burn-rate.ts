/**
 * Phase 3 Task 1: burn-rate computation over the sliding-window sample set.
 * Two distinct estimates are produced from real signal — recent pace (last
 * two samples) and whole-window average pace — rather than one, because
 * forecast.ts turns their disagreement into the honest range D-004 requires.
 */

import type { BurnRateEstimate, BurnSample } from "./types";

/** Returns null when there's not enough data yet — a real gap, not a guess. */
export function estimateBurnRates(samples: BurnSample[]): BurnRateEstimate[] | null {
  if (samples.length < 2) return null;
  const sorted = [...samples].sort((a, b) => a.timestamp - b.timestamp);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const recentPrev = sorted[sorted.length - 2]!;

  const estimates: BurnRateEstimate[] = [];
  const windowAverage = ratePerMinute(first, last);
  if (windowAverage !== null) estimates.push({ percentPerMinute: windowAverage, basis: "window-average" });
  const recent = ratePerMinute(recentPrev, last);
  if (recent !== null) estimates.push({ percentPerMinute: recent, basis: "recent" });

  return estimates.length > 0 ? estimates : null;
}

function ratePerMinute(from: BurnSample, to: BurnSample): number | null {
  const minutes = (to.timestamp - from.timestamp) / 60_000;
  if (minutes <= 0) return null;
  return (to.usedPercentage - from.usedPercentage) / minutes;
}
