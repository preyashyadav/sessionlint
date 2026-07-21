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

/** Splits summed cache_creation_input_tokens into 5m/1h buckets from each usage bag's
 * nested `cache_creation` object. Falls back to treating the whole amount as 5m-rate
 * (a conservative middle assumption, not a silent guess) when a bag has cache-creation
 * tokens but no nested breakdown — an older/degraded schema. */
function extractCacheBreakdown(rawBags: Record<string, unknown>[]): CacheCreationBreakdown {
  let ephemeral5m = 0;
  let ephemeral1h = 0;
  let breakdownAvailable = true;

  for (const bag of rawBags) {
    const totalCacheCreation = numberField(bag, "cache_creation_input_tokens");
    const nested = bag["cache_creation"];
    if (nested && typeof nested === "object") {
      ephemeral5m += numberField(nested as Record<string, unknown>, "ephemeral_5m_input_tokens");
      ephemeral1h += numberField(nested as Record<string, unknown>, "ephemeral_1h_input_tokens");
    } else if (totalCacheCreation > 0) {
      ephemeral5m += totalCacheCreation;
      breakdownAvailable = false;
    }
  }

  return { ephemeral5m, ephemeral1h, breakdownAvailable };
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
  };
}

export function computeTurnCost(turn: Turn, asOf: Date = new Date()): TurnCostBreakdown {
  if (!turn.model) return zeroBreakdown(turn.turnId, turn.modelRaw);

  // Price a turn at the rate in effect WHEN IT RAN, not when the report is generated.
  // A session from inside an intro-pricing window keeps its intro rate forever; only
  // turns that actually ran after the boundary get the standard rate. Falling back to
  // `asOf` covers transcripts with no usable timestamp.
  const rate = getModelRate(turn.model, turn.startedAt ?? asOf);
  if (!rate) return zeroBreakdown(turn.turnId, turn.model);

  const usage = turn.usage;
  const { ephemeral5m, ephemeral1h, breakdownAvailable } = extractCacheBreakdown(usage?.raw ?? []);

  const inputCost = ((usage?.inputTokens ?? 0) / 1_000_000) * rate.inputPerMTok;
  const cacheWriteCost =
    (ephemeral5m / 1_000_000) * rate.cacheWrite5mPerMTok + (ephemeral1h / 1_000_000) * rate.cacheWrite1hPerMTok;
  const cacheReadCost = ((usage?.cacheReadInputTokens ?? 0) / 1_000_000) * rate.cacheReadPerMTok;
  const outputCost = ((usage?.outputTokens ?? 0) / 1_000_000) * rate.outputPerMTok;

  return {
    turnId: turn.turnId,
    model: turn.model,
    pricingKnown: true,
    inputCost,
    cacheWriteCost,
    cacheReadCost,
    outputCost,
    totalCost: inputCost + cacheWriteCost + cacheReadCost + outputCost,
    cacheBreakdownAssumed: !breakdownAvailable,
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
  };
}
