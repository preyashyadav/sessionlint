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
/** US-only inference (`inference_geo: "us"`) bills 1.1x across every token category. */
export const INFERENCE_GEO_US_MULTIPLIER = 1.1;

/**
 * Per-API-response billing modifiers, read straight off the response's own usage
 * bag. Both are recorded by Claude Code on every assistant message, so this is
 * observed data rather than configuration sessionlint has to be told about.
 */
export interface UsageModifiers {
  /** Usage bag `speed` — "fast" bills at the model's published fast-mode rate. */
  speed?: string | null;
  /** Usage bag `inference_geo` — "us" adds the data-residency premium. */
  inferenceGeo?: string | null;
}

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
  /** Billed at the model's published fast-mode rate rather than its base rate. */
  fastModeApplied: boolean;
  /** The 1.1x US data-residency premium was applied to every category. */
  inferenceGeoUsApplied: boolean;
}

function resolve(model: string, rate: ModelRate, asOf: Date, mods?: UsageModifiers): ResolvedRate {
  const introRateExpired = rate.effectiveUntil ? asOf > new Date(rate.effectiveUntil) : false;

  // Once the intro window closes, bill the published standard rate. Without this the
  // engine keeps charging an expired intro price forever and silently under-reports.
  // When the post-intro rate is NOT published we cannot invent one — keep the intro
  // rate and let `introRateExpired` drive a visible warning instead of a fabricated
  // number (D-004). No model carries an intro rate today (see table.ts on Sonnet 5),
  // but the mechanism stays wired for the next one that does.
  const expiredWithKnownRate = introRateExpired && rate.postIntroRate !== undefined;
  let inputPerMTok = expiredWithKnownRate ? rate.postIntroRate!.inputPerMTok : rate.inputPerMTok;
  let outputPerMTok = expiredWithKnownRate ? rate.postIntroRate!.outputPerMTok : rate.outputPerMTok;

  // Fast mode REPLACES the base rate (it is a separate published price, not a
  // multiplier), and only for models that publish one — `speed: "fast"` against a
  // model without a `fastRate` bills normally, which is the documented behavior.
  const fastModeApplied = mods?.speed === "fast" && rate.fastRate !== undefined;
  if (fastModeApplied) {
    inputPerMTok = rate.fastRate!.inputPerMTok;
    outputPerMTok = rate.fastRate!.outputPerMTok;
  }

  // Data residency stacks on top of fast mode, and applies to cache categories too
  // — which it does automatically here, since cache rates derive from the (already
  // adjusted) base input rate. Keyed strictly on the literal "us": other observed
  // values ("global", "not_available") bill at standard rates, and inventing a
  // premium for an unrecognised value would be exactly the guess D-004 forbids.
  const inferenceGeoUsApplied = mods?.inferenceGeo === "us";
  if (inferenceGeoUsApplied) {
    inputPerMTok *= INFERENCE_GEO_US_MULTIPLIER;
    outputPerMTok *= INFERENCE_GEO_US_MULTIPLIER;
  }

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
    fastModeApplied,
    inferenceGeoUsApplied,
  };
}

export function getModelRate(
  modelId: string,
  asOf: Date = new Date(),
  table: PricingTable = PRICING_TABLE,
  mods?: UsageModifiers
): ResolvedRate | null {
  const rate = table.models[modelId];
  if (!rate) return null;
  return resolve(modelId, rate, asOf, mods);
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
