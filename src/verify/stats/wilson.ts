/**
 * Wilson score interval (Phase 2, Task 5). Used instead of a naive
 * successes/trials +/- normal-approximation interval because Wilson stays
 * well-behaved at small n and at the extremes (k=0 or k=n) — exactly the
 * regime a 40-sample verify run lives in.
 */

export interface WilsonInterval {
  low: number;
  high: number;
}

/** z = 1.96 is the default (95% confidence). */
export function wilsonInterval(successes: number, trials: number, z = 1.96): WilsonInterval {
  if (trials === 0) return { low: 0, high: 1 }; // no data at all — the honest widest possible bound

  const p = successes / trials;
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / denominator;

  return {
    low: Math.max(0, center - margin),
    high: Math.min(1, center + margin),
  };
}
