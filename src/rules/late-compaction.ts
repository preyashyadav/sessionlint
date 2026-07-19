/**
 * Late-compaction. Verified real schema (not in the sanitized fixture corpus,
 * found by scanning the broader local ~/.claude/projects history): a
 * `type: "system"` entry carries `compactMetadata: { trigger, preTokens,
 * postTokens, durationMs, cumulativeDroppedTokens, ... }`, immediately
 * followed by a `type: "user"` entry with `isCompactSummary: true`.
 *
 * `trigger: "auto"` means the context filled up before anyone ran /compact —
 * a smell worth flagging. `trigger: "manual"` is the user proactively
 * managing context and is never flagged.
 *
 * Cost impact (D-008 P0): counterfactual = a proactive /compact at the start
 * of the growth window would have reduced context to ~postTokens (this
 * compaction's own observed result — a real datapoint, not an invented
 * constant). The excess above that baseline was carried on every turn up to
 * and including the compaction turn. Both bounds are grounded in billing
 * that actually happened — never a hypothetical charge that could exceed the
 * session's real spend:
 *   - low: the excess was carried as cache reads only (cheapest way the
 *     observed carrying could have been billed).
 *   - high: adds the excess's proportional share of the cache WRITES that
 *     actually occurred in the window (growing context means part of each
 *     real re-write was re-writing the excess).
 * postTokens missing from the metadata ⇒ no costImpact, never a guess.
 */

import { computeTurnCost } from "../cost/compute";
import { resolveTurnRate } from "./cost-impact";
import { turnContextSize } from "./util";
import type { Session } from "../adapters/claude-code/types";
import type { CostImpactRange, Finding, Rule } from "./types";

export const LATE_COMPACTION_RULE_ID = "late-compaction";

interface CompactMetadata {
  trigger?: unknown;
  preTokens?: unknown;
  postTokens?: unknown;
  cumulativeDroppedTokens?: unknown;
}

export function detectLateCompactions(session: Session, asOf: Date = new Date()): Finding[] {
  const findings: Finding[] = [];
  let windowStart = 0; // growth window opens at session start or just after the previous compaction

  for (let turnIndex = 0; turnIndex < session.turns.length; turnIndex++) {
    const turn = session.turns[turnIndex]!;
    for (const entry of turn.entries) {
      const raw = entry.raw as { type?: unknown; compactMetadata?: unknown };
      if (raw.type !== "system" || !raw.compactMetadata || typeof raw.compactMetadata !== "object") continue;

      const meta = raw.compactMetadata as CompactMetadata;
      if (meta.trigger !== "auto") {
        windowStart = turnIndex + 1; // manual /compact still resets the growth window
        continue;
      }

      const preTokens = typeof meta.preTokens === "number" ? meta.preTokens : null;
      const postTokens = typeof meta.postTokens === "number" ? meta.postTokens : null;
      const dropped = typeof meta.cumulativeDroppedTokens === "number" ? meta.cumulativeDroppedTokens : null;

      let costImpact: CostImpactRange | undefined;
      let assumptions: string[] | undefined;
      if (postTokens !== null) {
        // Window includes the compaction turn itself: its API calls ran BEFORE the
        // compaction, so its context snapshot is pre-compaction context. (When the
        // compaction entry instead lands in the post-compaction continuation turn,
        // that turn's context ≈ postTokens and its excess is ~0 — harmless.)
        let carryUsd = 0;
        let writeShareUsd = 0;
        for (let i = windowStart; i <= turnIndex; i++) {
          const t = session.turns[i]!;
          const ctx = turnContextSize(t);
          const excess = Math.max(0, ctx - postTokens);
          if (excess === 0) continue;
          const rate = resolveTurnRate(session, i, asOf);
          if (!rate) continue;
          carryUsd += (excess / 1_000_000) * rate.cacheReadPerMTok;
          writeShareUsd += (excess / ctx) * computeTurnCost(t, asOf).cacheWriteCost;
        }
        // Omit rather than emit a zero-width range (D-004): a window with no real
        // cache-write activity has no separable high bound.
        if (carryUsd > 0 && writeShareUsd > 0) {
          costImpact = { low: carryUsd, high: carryUsd + writeShareUsd };
          assumptions = [
            `counterfactual: a proactive /compact at the start of the growth window would have kept context at ~${postTokens.toLocaleString()} tokens (this compaction's own observed result)`,
            "low: the excess context was carried as cache reads only",
            "high: adds the excess's proportional share of the cache writes that actually occurred in the window",
          ];
        }
      }

      // Real compactMetadata entries don't always carry every field (verified: some real
      // entries lack cumulativeDroppedTokens) — join only what's present so a missing
      // middle clause never leaves a dangling ", (" behind.
      const parts = ["Context auto-compacted (not user-initiated)"];
      if (preTokens !== null) parts.push(`at ~${preTokens.toLocaleString()} tokens`);
      if (dropped !== null) parts.push(`dropping ~${dropped.toLocaleString()} tokens`);
      if (postTokens !== null) parts.push(`${postTokens.toLocaleString()} tokens preserved`);

      findings.push({
        ruleId: LATE_COMPACTION_RULE_ID,
        severity: "warning",
        turnRange: { fromTurnId: turn.turnId, toTurnId: turn.turnId },
        evidence:
          `${parts.join(", ")}. Running /compact proactively before hitting the limit keeps ` +
          "control over what's preserved.",
        costImpact,
        assumptions,
      });

      windowStart = turnIndex + 1;
    }
  }

  return findings;
}

export const lateCompactionRule: Rule = {
  id: LATE_COMPACTION_RULE_ID,
  detector: detectLateCompactions,
  fixDocUrl: "https://github.com/preyashyadav/sessionlint/blob/main/docs/rules/late-compaction.md",
  suppressible: true,
};
