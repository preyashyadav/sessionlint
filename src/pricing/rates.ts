/**
 * Rate resolution: derives cache write/read rates from a model's base input
 * rate via documented, API-wide multipliers (never hardcoded per model), and
 * checks table/intro-rate staleness. Unknown models resolve to `null` rather
 * than throwing or defaulting to zero — the cost engine treats that as a
 * named gap (pricingKnown: false), never a silent miscalculation.
 */

import { PRICING_TABLE, type ModelRate, type PricingTable } from "./table";

export const CACHE_WRITE_5M_MULTIPLIER = 1.25;
export const CACHE_WRITE_1H_MULTIPLIER = 2;
export const CACHE_READ_MULTIPLIER = 0.1;
export const STALENESS_WARNING_DAYS = 21;

export interface ResolvedRate {
  model: string;
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWrite5mPerMTok: number;
  cacheWrite1hPerMTok: number;
  cacheReadPerMTok: number;
  introRateExpired: boolean;
  /** Intro rate lapsed and no published replacement exists — cost is knowingly understated. */
  introRateExpiredWithoutReplacement: boolean;
}

function resolve(model: string, rate: ModelRate, asOf: Date): ResolvedRate {
  const introRateExpired = rate.effectiveUntil ? asOf > new Date(rate.effectiveUntil) : false;

  // Once the intro window closes, bill the published standard rate. Without this the
  // engine keeps charging an expired intro price forever and silently under-reports
  // (Sonnet 5: $2/$10 -> $3/$15, i.e. 33% low). When the post-intro rate is NOT
  // published we cannot invent one — keep the intro rate and let `introRateExpired`
  // drive a visible warning instead of a fabricated number (D-004).
  const expiredWithKnownRate = introRateExpired && rate.postIntroRate !== undefined;
  const inputPerMTok = expiredWithKnownRate ? rate.postIntroRate!.inputPerMTok : rate.inputPerMTok;
  const outputPerMTok = expiredWithKnownRate ? rate.postIntroRate!.outputPerMTok : rate.outputPerMTok;

  return {
    model,
    inputPerMTok,
    outputPerMTok,
    cacheWrite5mPerMTok: inputPerMTok * CACHE_WRITE_5M_MULTIPLIER,
    cacheWrite1hPerMTok: inputPerMTok * CACHE_WRITE_1H_MULTIPLIER,
    cacheReadPerMTok: inputPerMTok * CACHE_READ_MULTIPLIER,
    introRateExpired,
    // True only when the intro rate lapsed and we have no published replacement —
    // the one case where the reported cost is knowingly understated.
    introRateExpiredWithoutReplacement: introRateExpired && rate.postIntroRate === undefined,
  };
}

export function getModelRate(
  modelId: string,
  asOf: Date = new Date(),
  table: PricingTable = PRICING_TABLE
): ResolvedRate | null {
  const rate = table.models[modelId];
  if (!rate) return null;
  return resolve(modelId, rate, asOf);
}

export interface StalenessCheck {
  daysSince: number;
  stale: boolean;
}

export function checkStaleness(table: PricingTable = PRICING_TABLE, now: Date = new Date()): StalenessCheck {
  const retrieved = new Date(table.retrievedAt);
  const daysSince = Math.floor((now.getTime() - retrieved.getTime()) / 86_400_000);
  return { daysSince, stale: daysSince > STALENESS_WARNING_DAYS };
}
