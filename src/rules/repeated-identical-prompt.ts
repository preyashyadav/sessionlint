/**
 * Repeated-identical-prompt (retry smell). Flags when a human prompt is sent
 * again, verbatim, immediately after the previous turn — the local, adjacent
 * comparison that "retry right after an unsatisfying response" actually
 * looks like, not a global scan for coincidental repeats far apart.
 *
 * Note: this must be tested against synthetic fixtures with real prose, not
 * the sanitized real corpus — the sanitizer's filler text is a pure function
 * of string length, so two different real prompts of equal length collapse
 * to byte-identical placeholders and would falsely "match" after sanitizing.
 *
 * Cost impact (D-008 P0): an immediate verbatim retry implies the first
 * attempt's response was discarded. The first attempt's ACTUAL billed cost
 * (via the cost engine — reused, not reimplemented) bounds the waste:
 *   - low: only the discarded output was waste (the input-side context would
 *     have been paid for by any turn in its place).
 *   - high: the entire first attempt (input + cache + output) was waste.
 */

import { computeTurnCost } from "../cost/compute";
import { extractPromptText } from "./util";
import type { Session, Turn } from "../adapters/claude-code/types";
import type { CostImpactRange, Finding, Rule } from "./types";

export const REPEATED_IDENTICAL_PROMPT_RULE_ID = "repeated-identical-prompt";

export function detectRepeatedIdenticalPrompts(session: Session, asOf: Date = new Date()): Finding[] {
  const findings: Finding[] = [];
  let previousText: string | null = null;
  let previousTurn: Turn | null = null;

  for (const turn of session.turns) {
    const text = extractPromptText(turn);
    if (text === null) continue;

    if (previousText !== null && previousTurn !== null && text === previousText) {
      const preview = text.length > 80 ? `${text.slice(0, 80)}...` : text;

      const discarded = computeTurnCost(previousTurn, asOf);
      let costImpact: CostImpactRange | undefined;
      let assumptions: string[] | undefined;
      // Omit rather than emit a zero-width range (D-004) — pricingKnown:false or a
      // degenerate all-output turn both fall through to "not cost-quantifiable".
      if (discarded.pricingKnown && discarded.totalCost > discarded.outputCost) {
        costImpact = { low: discarded.outputCost, high: discarded.totalCost };
        assumptions = [
          "an immediate verbatim retry implies the first attempt's response was discarded",
          "low: only the discarded output was waste; high: the entire first attempt (input + cache + output) was waste",
        ];
      }

      findings.push({
        ruleId: REPEATED_IDENTICAL_PROMPT_RULE_ID,
        severity: "warning",
        turnRange: { fromTurnId: previousTurn.turnId, toTurnId: turn.turnId },
        evidence:
          `The same prompt was sent again immediately after the previous turn ("${preview}") — ` +
          "likely a retry after an unsatisfactory or interrupted response.",
        costImpact,
        assumptions,
      });
    }

    previousText = text;
    previousTurn = turn;
  }

  return findings;
}

export const repeatedIdenticalPromptRule: Rule = {
  id: REPEATED_IDENTICAL_PROMPT_RULE_ID,
  detector: detectRepeatedIdenticalPrompts,
  fixDocUrl: "https://github.com/preyashyadav/sessionlint/blob/main/docs/rules/repeated-identical-prompt.md",
  suppressible: true,
};
