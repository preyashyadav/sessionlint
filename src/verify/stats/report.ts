/**
 * Stats + verify report (Phase 2, Task 5). Ties together the sampler (full
 * nominated population + what was actually sampled/excluded), the judge
 * results, and cost data into per-stratum equivalence CIs and extrapolated
 * savings RANGES (never points, D-004).
 */

import type { LoadedSession } from "../../adapters/claude-code/session";
import type { Turn } from "../../adapters/claude-code/types";
import { getModelRate } from "../../pricing/rates";
import type { ThreeTierResult } from "../judge/types";
import { nominateCandidates } from "../nominate";
import { downgradeModelFor } from "../replay/downgrade";
import { contextStratum } from "../stratify";
import type { ContextStratum, SampleResult } from "../types";
import { wilsonInterval, type WilsonInterval } from "./wilson";

export const RECOMMENDATION_CONFIDENCE_THRESHOLD = 0.7; // matches the launch gate's ~70% bar (PHASE-2.md Task 7)

export interface StratumStats {
  stratum: ContextStratum;
  nominatedCount: number;
  sampledCount: number;
  equivalentCount: number;
  equivalenceRateCI: WilsonInterval;
  /** null when nothing in the stratum was judged — a Wilson CI on 0 observations is the
   * vacuous 0%-100%, and multiplying it into dollars would print a number with no evidence
   * behind it (the D-004 anti-pattern in reverse: a fabricated-looking range). */
  savingsRangeUsd: { low: number; high: number } | null;
}

export interface ReplayCallFailure {
  sessionId: string;
  turnId: string;
  message: string;
}

export interface ReplayCallInfo {
  failures: ReplayCallFailure[];
  /** Calls never attempted because an authentication failure aborted the run early. */
  skippedAfterAuthFailure: number;
}

export interface VerifyReport {
  totalNominated: number;
  totalSampled: number;
  totalExcluded: number;
  totalJudged: number;
  perStratum: StratumStats[];
  overallEquivalenceRateCI: WilsonInterval;
  /** null when zero turns were judged — see StratumStats.savingsRangeUsd. */
  totalSavingsRangeUsd: { low: number; high: number } | null;
  callFailures: ReplayCallFailure[];
  skippedAfterAuthFailure: number;
  recommendation: string;
  methodologyNotes: string[];
}

/** Approximates cache-write at the 5m TTL rate rather than Task 2's exact 5m/1h split — an
 * acceptable simplification for a savings ESTIMATE/range, not a per-turn billing figure. */
function costForModel(turn: Turn, model: string, asOf: Date): number {
  const rate = getModelRate(model, asOf);
  if (!rate || !turn.usage) return 0;
  const inputCost = (turn.usage.inputTokens / 1_000_000) * rate.inputPerMTok;
  const outputCost = (turn.usage.outputTokens / 1_000_000) * rate.outputPerMTok;
  const cacheReadCost = (turn.usage.cacheReadInputTokens / 1_000_000) * rate.cacheReadPerMTok;
  const cacheWriteCost = (turn.usage.cacheCreationInputTokens / 1_000_000) * rate.cacheWrite5mPerMTok;
  return inputCost + outputCost + cacheReadCost + cacheWriteCost;
}

export function computeRecommendation(overallCI: WilsonInterval, pooledSampled: number, failureCount = 0): string {
  if (pooledSampled === 0) {
    if (failureCount > 0) {
      return (
        `All ${failureCount} attempted replay/judge call(s) failed — nothing was judged, so this run ` +
        "supports no conclusion. Fix the failure listed above (often a missing ANTHROPIC_API_KEY) and re-run."
      );
    }
    return "No sampled turns were judged — nothing to recommend from this run.";
  }
  const lowPct = Math.round(overallCI.low * 100);
  if (overallCI.low >= RECOMMENDATION_CONFIDENCE_THRESHOLD) {
    return (
      `Even in the worst case of the confidence interval, at least ${lowPct}% of sampled ` +
      "premium-model text turns were equivalent on a cheaper model — consider defaulting " +
      "summary/explanation turns to the cheaper tier."
    );
  }
  return `Verified equivalence (worst case ${lowPct}%) doesn't clear a confident bar yet — no downgrade recommendation from this history.`;
}

export const METHODOLOGY_NOTES: readonly string[] = [
  'Replay omits the original system prompt (never logged by Claude Code) — this measures ' +
    'text-continuation equivalence without it, not literally "would the cheaper model have ' +
    'produced the identical session."',
  "Replay also omits tool_use/tool_result content from prior turns — only human/assistant text is reconstructed.",
  "Savings ranges are extrapolated from a sample via a 95% Wilson confidence interval on the " +
    "equivalence rate, scaled by the full nominated population's cost delta — not measured directly on every turn.",
  "Cache-write costs in this report approximate the 5-minute TTL rate rather than the exact " +
    "5m/1h split Task 2's cost engine uses per turn.",
];

export function buildVerifyReport(
  loaded: LoadedSession[],
  sampleResult: SampleResult,
  judgeResults: ThreeTierResult[],
  asOf: Date = new Date(),
  callInfo: ReplayCallInfo = { failures: [], skippedAfterAuthFailure: 0 }
): VerifyReport {
  const nominated: Array<{ sessionId: string; turnId: string; turn: Turn; stratum: ContextStratum; downgradeModel: string }> = [];
  for (const { session } of loaded) {
    for (const candidate of nominateCandidates(session)) {
      const turn = session.turns.find((t) => t.turnId === candidate.turnId);
      if (!turn || !turn.model) continue;
      const downgradeModel = downgradeModelFor(turn.model);
      if (!downgradeModel) continue;
      nominated.push({
        sessionId: candidate.sessionId,
        turnId: candidate.turnId,
        turn,
        stratum: contextStratum(candidate.contextSizeAtTurn),
        downgradeModel,
      });
    }
  }

  const judgeByKey = new Map(judgeResults.map((r) => [`${r.sessionId}:${r.turnId}`, r]));
  const sampledKeys = new Set(sampleResult.sampled.map((c) => `${c.sessionId}:${c.turnId}`));

  const strata: ContextStratum[] = ["small", "medium", "large"];
  const perStratum: StratumStats[] = [];
  let pooledSampled = 0;
  let pooledEquivalent = 0;
  let totalSavingsLow = 0;
  let totalSavingsHigh = 0;

  for (const stratum of strata) {
    const inStratum = nominated.filter((n) => n.stratum === stratum);

    let equivalentCount = 0;
    let judgedCount = 0;
    for (const n of inStratum) {
      if (!sampledKeys.has(`${n.sessionId}:${n.turnId}`)) continue;
      const result = judgeByKey.get(`${n.sessionId}:${n.turnId}`);
      if (!result) continue;
      judgedCount++;
      if (result.finalVerdict === "equivalent") equivalentCount++;
    }

    const equivalenceRateCI = wilsonInterval(equivalentCount, judgedCount);
    const totalStratumCost = inStratum.reduce((sum, n) => sum + costForModel(n.turn, n.turn.model!, asOf), 0);
    const downgradeStratumCost = inStratum.reduce((sum, n) => sum + costForModel(n.turn, n.downgradeModel, asOf), 0);
    const maxDelta = Math.max(0, totalStratumCost - downgradeStratumCost);

    const savingsRangeUsd =
      judgedCount === 0 ? null : { low: equivalenceRateCI.low * maxDelta, high: equivalenceRateCI.high * maxDelta };

    perStratum.push({
      stratum,
      nominatedCount: inStratum.length,
      sampledCount: judgedCount,
      equivalentCount,
      equivalenceRateCI,
      savingsRangeUsd,
    });

    pooledSampled += judgedCount;
    pooledEquivalent += equivalentCount;
    if (savingsRangeUsd) {
      totalSavingsLow += savingsRangeUsd.low;
      totalSavingsHigh += savingsRangeUsd.high;
    }
  }

  const overallEquivalenceRateCI = wilsonInterval(pooledEquivalent, pooledSampled);

  return {
    totalNominated: nominated.length,
    totalSampled: sampleResult.sampled.length,
    totalExcluded: sampleResult.excluded.length,
    totalJudged: pooledSampled,
    perStratum,
    overallEquivalenceRateCI,
    totalSavingsRangeUsd: pooledSampled === 0 ? null : { low: totalSavingsLow, high: totalSavingsHigh },
    callFailures: callInfo.failures,
    skippedAfterAuthFailure: callInfo.skippedAfterAuthFailure,
    recommendation: computeRecommendation(overallEquivalenceRateCI, pooledSampled, callInfo.failures.length),
    methodologyNotes: [...METHODOLOGY_NOTES],
  };
}
