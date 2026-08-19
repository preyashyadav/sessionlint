/**
 * Per-turn / per-session cost computation (C-2). Always deterministic, exact
 * arithmetic from tokens x the pinned pricing table — "estimate" framing for
 * subscription users is a report-rendering label (Task 5), not a change to
 * this math (D-004; MASTER.md decision on Claude Code's own notional
 * cost.total_cost_usd field).
 */

import type { Session, Turn } from "../adapters/claude-code/types";
import { checkStaleness, getModelRate } from "../pricing/rates";
import { PRICING_TABLE } from "../pricing/table";
import type { SessionCostSummary, TurnCostBreakdown } from "./types";

interface CacheCreationBreakdown {
  ephemeral5m: number;
  ephemeral1h: number;
  breakdownAvailable: boolean;
}

function numberField(bag: Record<string, unknown>, key: string): number {
  const v = bag[key];
  return typeof v === "number" ? v : 0;
}

function stringField(bag: Record<string, unknown>, key: string): string | null {
  const v = bag[key];
  return typeof v === "string" ? v : null;
}

/** Splits one bag's cache_creation_input_tokens into 5m/1h buckets from its nested
 * `cache_creation` object. Falls back to treating the whole amount as 5m-rate (a
 * conservative middle assumption, not a silent guess) when a bag has cache-creation
 * tokens but no nested breakdown — an older/degraded schema. */
function splitCacheCreation(bag: Record<string, unknown>): CacheCreationBreakdown {
  const nested = bag["cache_creation"];
  if (nested && typeof nested === "object") {
    return {
      ephemeral5m: numberField(nested as Record<string, unknown>, "ephemeral_5m_input_tokens"),
      ephemeral1h: numberField(nested as Record<string, unknown>, "ephemeral_1h_input_tokens"),
      breakdownAvailable: true,
    };
  }
  const totalCacheCreation = numberField(bag, "cache_creation_input_tokens");
  if (totalCacheCreation > 0) {
    return { ephemeral5m: totalCacheCreation, ephemeral1h: 0, breakdownAvailable: false };
  }
  return { ephemeral5m: 0, ephemeral1h: 0, breakdownAvailable: true };
}

/**
 * The per-response usage bags to price. `speed` and `inference_geo` are per-response
 * billing modifiers, so cost has to be accumulated bag by bag rather than by pricing
 * the turn's summed totals once. For a turn whose responses all share one rate the
 * two are arithmetically identical (multiplication distributes over the sum), so this
 * does not disturb the ground-truth match verified in Phase 6 T1.
 *
 * `UsageTotals.raw` is the source those totals were summed from and is non-empty for
 * any real transcript. The synthesized-bag fallback covers hand-built usage objects
 * (test fixtures, future adapters) that carry totals without raw bags — pricing those
 * at base rates preserves the pre-existing behavior exactly.
 */
function priceableBags(usage: Turn["usage"]): Record<string, unknown>[] {
  if (!usage) return [];
  if (usage.raw.length > 0) return usage.raw;
  return [
    {
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      cache_creation_input_tokens: usage.cacheCreationInputTokens,
      cache_read_input_tokens: usage.cacheReadInputTokens,
    },
  ];
}

function zeroBreakdown(turnId: string, model: string | null): TurnCostBreakdown {
  return {
    turnId,
    model,
    pricingKnown: false,
    inputCost: 0,
    cacheWriteCost: 0,
    cacheReadCost: 0,
    outputCost: 0,
    totalCost: 0,
    cacheBreakdownAssumed: false,
    fastMode: false,
    inferenceGeoUs: false,
  };
}

export function computeTurnCost(turn: Turn, asOf: Date = new Date()): TurnCostBreakdown {
  if (!turn.model) return zeroBreakdown(turn.turnId, turn.modelRaw);

  // Price a turn at the rate in effect WHEN IT RAN, not when the report is generated.
  // A session from inside an intro-pricing window keeps its intro rate forever; only
  // turns that actually ran after the boundary get the standard rate. Falling back to
  // `asOf` covers transcripts with no usable timestamp.
  const when = turn.startedAt ?? asOf;
  if (!getModelRate(turn.model, when)) return zeroBreakdown(turn.turnId, turn.model);

  let inputCost = 0;
  let cacheWriteCost = 0;
  let cacheReadCost = 0;
  let outputCost = 0;
  let cacheBreakdownAssumed = false;
  let fastMode = false;
  let inferenceGeoUs = false;

  for (const bag of priceableBags(turn.usage)) {
    const rate = getModelRate(turn.model, when, PRICING_TABLE, {
      speed: stringField(bag, "speed"),
      inferenceGeo: stringField(bag, "inference_geo"),
    });
    if (!rate) continue; // unreachable: the same model resolved above
    if (rate.fastModeApplied) fastMode = true;
    if (rate.inferenceGeoUsApplied) inferenceGeoUs = true;

    const { ephemeral5m, ephemeral1h, breakdownAvailable } = splitCacheCreation(bag);
    if (!breakdownAvailable) cacheBreakdownAssumed = true;

    inputCost += (numberField(bag, "input_tokens") / 1_000_000) * rate.inputPerMTok;
    cacheWriteCost +=
      (ephemeral5m / 1_000_000) * rate.cacheWrite5mPerMTok + (ephemeral1h / 1_000_000) * rate.cacheWrite1hPerMTok;
    cacheReadCost += (numberField(bag, "cache_read_input_tokens") / 1_000_000) * rate.cacheReadPerMTok;
    outputCost += (numberField(bag, "output_tokens") / 1_000_000) * rate.outputPerMTok;
  }

  return {
    turnId: turn.turnId,
    model: turn.model,
    pricingKnown: true,
    inputCost,
    cacheWriteCost,
    cacheReadCost,
    outputCost,
    totalCost: inputCost + cacheWriteCost + cacheReadCost + outputCost,
    cacheBreakdownAssumed,
    fastMode,
    inferenceGeoUs,
  };
}

export function computeSessionCost(session: Session, asOf: Date = new Date()): SessionCostSummary {
  const perTurn = session.turns.map((t) => computeTurnCost(t, asOf));
  const totalCost = perTurn.reduce((sum, t) => sum + t.totalCost, 0);
  const turnsWithUnknownPricing = perTurn.filter((t) => !t.pricingKnown).length;
  const { stale } = checkStaleness(PRICING_TABLE, asOf);

  return {
    sessionId: session.sessionId,
    totalCost,
    perTurn,
    turnsWithUnknownPricing,
    pricingStale: stale,
    fastModeTurns: perTurn.filter((t) => t.fastMode).length,
    inferenceGeoUsTurns: perTurn.filter((t) => t.inferenceGeoUs).length,
  };
}
