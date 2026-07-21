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

/**
 * Fraction of the model's context window at which carrying everything forward starts
 * to look like a real habit rather than a normal long session. The old flat 500,000
 * fired at HALF of a 1M window and flagged nearly every substantial session.
 */
export const CONTEXT_WINDOW_FRACTION = 0.75;

/** Context windows are 1M on every current model except Haiku (200K). Verified 2026-07-20. */
const DEFAULT_CONTEXT_WINDOW = 1_000_000;
const CONTEXT_WINDOWS: Record<string, number> = {
  "claude-haiku-4-5": 200_000,
};

/**
 * A crossing this close to the end of the session is not actionable — by the time the
 * context grew, the session was already over. Telling someone to /clear at turn 5 of a
 * 6-turn session is noise, not advice.
 */
export const MIN_TURNS_AFTER_CROSSING = 3;

function contextThresholdFor(model: string | null): number {
  const window = (model !== null ? CONTEXT_WINDOWS[model] : undefined) ?? DEFAULT_CONTEXT_WINDOW;
  return window * CONTEXT_WINDOW_FRACTION;
}

export function detectMissingClearAtTopicBoundary(session: Session, asOf: Date = new Date()): Finding[] {
  const turns = session.turns;

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i]!;
    const contextAtCrossing = turnContextSize(turn);
    if (contextAtCrossing <= contextThresholdFor(turn.model)) continue;

    // Not actionable if the session ended right after the crossing.
    if (turns.length - 1 - i < MIN_TURNS_AFTER_CROSSING) continue;

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
        // Stated plainly: the high bound is a ceiling, not an expectation. It requires that
        // none of the carried context was actually needed by the later turns — rarely true
        // in a session that kept doing productive work. Treat the LOW bound as the realistic
        // figure and the high bound as the theoretical maximum.
        "the high bound assumes NONE of the carried context was needed afterwards — usually false; treat low as the realistic figure",
        "both bounds bill carried context at cache-read rate (the cheapest rate), so neither is inflated",
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
