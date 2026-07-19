/** T3 human spot-check selection (Phase 2, Task 4). "Uncertain" verdicts ARE the borderline
 * cases by definition — the judge disagreed with itself across orders — so selection is just
 * those, capped at n (default 5 per the phase spec). No continuous confidence score exists
 * to rank further; this doesn't invent one. */

import type { ThreeTierResult } from "./types";

export const DEFAULT_SPOT_CHECK_COUNT = 5;

export function selectBorderlineForSpotCheck(
  results: ThreeTierResult[],
  n: number = DEFAULT_SPOT_CHECK_COUNT
): ThreeTierResult[] {
  return results.filter((r) => r.finalVerdict === "uncertain").slice(0, n);
}
