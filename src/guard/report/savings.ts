/**
 * "watchdog saved ~$X (range)" — mirrors Phase 3's forecast.ts pattern:
 * multiple rate estimates, a fixed uncertainty margin on top, low/high never
 * equal even in the degenerate case both estimates agree exactly (D-004).
 *
 * The projection is deliberately anchored to the user's OWN configured
 * --budget/--max-iters headroom, not an invented "assume N more iterations"
 * constant — if neither was set there's no defined stopping point to
 * extrapolate to, so this returns null rather than a fabricated number
 * (same "never guess" posture as C-1/D-003 elsewhere in this codebase).
 */

import type { IterationReportEntry, WatchdogSavingsEstimate } from "./types";

const UNCERTAINTY_MARGIN = 0.2;

export function estimateWatchdogSavings(
  iterations: IterationReportEntry[],
  totalCostUsd: number | null,
  budgetUsd: number | null,
  maxIters: number | null
): WatchdogSavingsEstimate | null {
  const costed = iterations.filter((it) => it.costUsd !== null) as (IterationReportEntry & { costUsd: number })[];
  if (costed.length === 0) return null;

  const overallRate = costed.reduce((sum, it) => sum + it.costUsd, 0) / costed.length;
  const recentRate = costed[costed.length - 1]!.costUsd;
  const rates = [overallRate, recentRate].filter((r) => r > 0);
  if (rates.length === 0) return null;

  let remainingIters: number | null = null;
  if (maxIters !== null) {
    remainingIters = Math.max(0, maxIters - iterations.length);
  } else if (budgetUsd !== null && totalCostUsd !== null) {
    const headroomUsd = Math.max(0, budgetUsd - totalCostUsd);
    remainingIters = headroomUsd / Math.max(...rates);
  }
  if (remainingIters === null || remainingIters <= 0) return null;

  const projections = rates.map((r) => r * remainingIters!);
  const bounds = projections.flatMap((p) => [p * (1 - UNCERTAINTY_MARGIN), p * (1 + UNCERTAINTY_MARGIN)]);

  const lowUsd = Math.max(0, Math.min(...bounds));
  const highUsd = Math.max(Math.max(...bounds), lowUsd + 0.01);

  return { lowUsd, highUsd };
}
