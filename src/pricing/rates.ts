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
}

function resolve(model: string, rate: ModelRate, asOf: Date): ResolvedRate {
  return {
    model,
    inputPerMTok: rate.inputPerMTok,
    outputPerMTok: rate.outputPerMTok,
    cacheWrite5mPerMTok: rate.inputPerMTok * CACHE_WRITE_5M_MULTIPLIER,
    cacheWrite1hPerMTok: rate.inputPerMTok * CACHE_WRITE_1H_MULTIPLIER,
    cacheReadPerMTok: rate.inputPerMTok * CACHE_READ_MULTIPLIER,
    introRateExpired: rate.effectiveUntil ? asOf > new Date(rate.effectiveUntil) : false,
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
