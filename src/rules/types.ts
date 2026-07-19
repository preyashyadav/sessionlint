/**
 * Rule v0 (C-3). Shared shape for every lint rule — the hero rule
 * (cache-nuke, this task) and Task 4's folklore rules both conform to this.
 */

import type { Session } from "../adapters/claude-code/types";

export interface CostImpactRange {
  low: number;
  high: number;
}

export interface Finding {
  ruleId: string;
  severity: "error" | "warning" | "info";
  turnRange: { fromTurnId: string; toTurnId: string };
  /** Human-readable evidence line(s) — what the report prints under the finding header. */
  evidence: string;
  /** USD range; absent when the finding isn't cost-quantifiable (D-004: never a false point
   * estimate). When present, low is strictly below high — a detector must omit the field
   * entirely rather than emit a zero-width range. */
  costImpact?: CostImpactRange;
  /** The labeled counterfactual assumptions the costImpact bounds span (D-004). Present
   * whenever costImpact is; carried into --json and --md, not the terminal view. */
  assumptions?: string[];
}

export interface Rule {
  id: string;
  detector: (session: Session) => Finding[];
  fixDocUrl: string;
  suppressible: true;
  /** Former IDs this rule has been renamed from. `--suppress <old-id>` keeps working after a
   * rename so a user's suppress list never silently breaks. Findings always carry the current
   * `id`; aliases only ever appear on the input side (suppression). */
  aliases?: string[];
}
