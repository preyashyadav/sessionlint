/**
 * Cache-nuke detector — the hero rule (Phase 1, Task 3). Prompt caches are
 * model-scoped (a switch can't read the prior model's cache — see
 * shared/prompt-caching.md's "don't change tools or model mid-conversation"
 * guidance in the claude-api skill). A switch can therefore prevent a cache
 * read, but only when the prior cache was still warm. The default prompt-cache
 * TTL is five minutes; a longer idle gap can make the cache cold independently
 * of a model switch, so this rule must not claim the switch caused that cost.
 *
 * "Reprocessed tokens" is directly observed, not estimated: it's the switch
 * turn's FIRST API call's fresh input_tokens (nothing could be cache-read
 * under the new model on that first call — later calls in the same turn
 * already build a cache under the new model, so only the first call is
 * fully attributable to the switch). Cost impact IS an honest range (D-004) because we can't know for
 * certain what the counterfactual (no-switch) cost would have been — the
 * range spans two bounding assumptions:
 *   - high: the content would definitely have been a cache read on the old
 *     model (best-case no-switch cost -> largest attributable cache-nuke cost)
 *   - low: the content might not have been cached anyway even without a
 *     switch (worst-case no-switch cost -> smallest, possibly negative,
 *     attributable cost — a switch to a much cheaper model can net save
 *     money despite invalidating the cache)
 */

import { getModelRate } from "../pricing/rates";
import { firstCallInputTokens, turnContextSize } from "./util";
import type { Session } from "../adapters/claude-code/types";
import type { CostImpactRange, Finding, Rule } from "./types";

export const CACHE_NUKE_RULE_ID = "cache-nuke";
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

function latestTurnTimestamp(turn: Session["turns"][number]): Date | null {
  let latest: Date | null = null;
  for (const entry of turn.entries) {
    if (entry.timestamp && (!latest || entry.timestamp > latest)) latest = entry.timestamp;
  }
  return latest;
}

export function detectCacheNukes(session: Session, asOf: Date = new Date()): Finding[] {
  const findings: Finding[] = [];
  const turnIndex = new Map(session.turns.map((t, i) => [t.turnId, i]));

  for (const sw of session.modelSwitches) {
    const toIndex = turnIndex.get(sw.atTurnId);
    if (toIndex === undefined || toIndex === 0) continue; // no prior turn to attribute the switch to

    const toTurn = session.turns[toIndex]!;
    const fromTurn = session.turns[toIndex - 1]!;

    const reprocessedTokens = firstCallInputTokens(toTurn);
    const contextSizeAtSwitch = turnContextSize(fromTurn);
    const previousTimestamp = latestTurnTimestamp(fromTurn);
    const switchTimestamp = sw.atTimestamp ?? toTurn.startedAt;
    const gapMs =
      previousTimestamp && switchTimestamp
        ? Math.max(0, switchTimestamp.getTime() - previousTimestamp.getTime())
        : null;
    const cacheLikelyExpired = gapMs !== null && gapMs > DEFAULT_CACHE_TTL_MS;

    const toRate = getModelRate(sw.toModel, asOf);
    const fromRate = getModelRate(sw.fromModel, asOf);

    let costImpact: CostImpactRange | undefined;
    let assumptions: string[] | undefined;
    if (toRate && fromRate && reprocessedTokens > 0 && !cacheLikelyExpired) {
      const millionTokens = reprocessedTokens / 1_000_000;
      const actualCost = millionTokens * toRate.inputPerMTok;
      const ifCacheWouldHaveHit = actualCost - millionTokens * fromRate.cacheReadPerMTok;
      const ifCacheMightNotHaveHit = actualCost - millionTokens * fromRate.inputPerMTok;
      costImpact = {
        low: Math.min(ifCacheWouldHaveHit, ifCacheMightNotHaveHit),
        high: Math.max(ifCacheWouldHaveHit, ifCacheMightNotHaveHit),
      };
      assumptions = [
        "high: without the switch, the reprocessed content would have remained a cache read on the old model",
        "low: the content might not have been cached anyway (a switch to a much cheaper model can net save money despite invalidating the cache)",
      ];
    }

    let severity: Finding["severity"] = "warning";
    if (cacheLikelyExpired || (costImpact && costImpact.high <= 0)) severity = "info";
    else if (costImpact && costImpact.low > 0) severity = "error";

    const timingEvidence =
      gapMs === null
        ? " Cache warmth cannot be established because the turn timestamps are incomplete."
        : cacheLikelyExpired
          ? ` The ${(gapMs / 60_000).toFixed(1)}-minute idle gap exceeded the default 5-minute cache TTL, so the cache may have expired without the switch; no avoidable cost is attributed to it.`
          : ` The switch occurred ${(gapMs / 1000).toFixed(0)} seconds after the prior turn, within the default 5-minute cache TTL.`;
    const priceEvidence =
      costImpact && costImpact.high <= 0
        ? " At current API-equivalent rates, the cheaper model likely saved money even after fresh-input processing."
        : "";

    findings.push({
      ruleId: CACHE_NUKE_RULE_ID,
      severity,
      turnRange: { fromTurnId: fromTurn.turnId, toTurnId: toTurn.turnId },
      evidence:
        `Model switch ${sw.fromModel} -> ${sw.toModel} was followed by ` +
        `~${reprocessedTokens.toLocaleString()} tokens billed as fresh input ` +
        `(context size at switch: ~${contextSizeAtSwitch.toLocaleString()} tokens).` +
        timingEvidence +
        priceEvidence,
      costImpact,
      assumptions,
    });
  }

  return findings.sort((a, b) => (b.costImpact?.high ?? 0) - (a.costImpact?.high ?? 0));
}

export const cacheNukeRule: Rule = {
  id: CACHE_NUKE_RULE_ID,
  detector: detectCacheNukes,
  fixDocUrl: "https://github.com/preyashyadav/sessionlint/blob/main/docs/rules/cache-nuke.md",
  suppressible: true,
};
