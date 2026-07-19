/**
 * Missing-/clear-at-topic-boundary. Conservative heuristic — precision over
 * recall (D-004 spirit), per the phase spec: there's no real "topic boundary"
 * marker in the schema, so this only fires on a high absolute context-size
 * threshold (few false positives) and only once per session (the first
 * crossing), and never fires if a compaction event (see late-compaction.ts)
 * already addressed the growth later in the session.
 *
 * Cost impact (D-008 P0): counterfactual = /clear or /compact at the flagged
 * turn. The bounds span how much that action would have dropped:
 *   - low: it only stopped further growth (kept ~the flagged turn's context),
 *     so only the post-crossing GROWTH was avoidable carrying cost.
 *   - high: it was a /clear (kept ~nothing), so the entire carried context
 *     from the crossing onward was avoidable.
 * Both bounds bill carried context at cache-read rate — real cache expiries
 * would bill higher, so even the high bound is not inflated.
 */

import { excessCarryCost } from "./cost-impact";
import { isCompactionEntry, turnContextSize } from "./util";
import type { Session } from "../adapters/claude-code/types";
import type { CostImpactRange, Finding, Rule } from "./types";

export const MISSING_CLEAR_RULE_ID = "missing-clear-at-topic-boundary";
export const CONTEXT_SIZE_THRESHOLD = 500_000;

export function detectMissingClearAtTopicBoundary(session: Session, asOf: Date = new Date()): Finding[] {
  const turns = session.turns;

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i]!;
    const contextAtCrossing = turnContextSize(turn);
    if (contextAtCrossing <= CONTEXT_SIZE_THRESHOLD) continue;

    const laterEntries = turns.slice(i).flatMap((t) => t.entries);
    if (laterEntries.some(isCompactionEntry)) continue; // already handled — not "missing"

    const growthOnly = excessCarryCost(session, i + 1, turns.length, contextAtCrossing, asOf);
    const everything = excessCarryCost(session, i, turns.length, 0, asOf);
    let costImpact: CostImpactRange | undefined;
    let assumptions: string[] | undefined;
    if (everything > growthOnly) {
      costImpact = { low: growthOnly, high: everything };
      assumptions = [
        "counterfactual: /clear or /compact at the flagged turn",
        `low: the action only stopped further context growth (kept ~${contextAtCrossing.toLocaleString()} tokens); only post-crossing growth counted`,
        "high: the action was a /clear (kept ~nothing); the entire carried context from the crossing onward counted",
        "both bounds bill carried context at cache-read rate — real cache expiries would bill higher",
      ];
    }

    const lastTurn = turns[turns.length - 1]!;
    return [
      {
        ruleId: MISSING_CLEAR_RULE_ID,
        severity: "warning",
        turnRange: { fromTurnId: turn.turnId, toTurnId: lastTurn.turnId },
        evidence:
          `Context grew to ~${contextAtCrossing.toLocaleString()} tokens and was never cleared ` +
          "or compacted for the rest of the session — consider /clear or /compact at a natural topic boundary.",
        costImpact,
        assumptions,
      },
    ];
  }

  return [];
}

export const missingClearAtTopicBoundaryRule: Rule = {
  id: MISSING_CLEAR_RULE_ID,
  detector: detectMissingClearAtTopicBoundary,
  fixDocUrl: "https://github.com/preyashyadav/sessionlint/blob/main/docs/rules/missing-clear-at-topic-boundary.md",
  suppressible: true,
};
