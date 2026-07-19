import type { CostImpactRange } from "../rules/types";

export interface CostSummary {
  /** Actual computed cost for the session (exact tokens x pinned pricing). */
  estimated: number;
  /** estimated minus the summed finding cost-impact range (floored at 0): low subtracts the
   * findings' high bounds, high subtracts their lows. Absent when no finding was
   * cost-quantified — renderers must then omit the clause, never print a point (D-004). */
  couldHaveBeen?: CostImpactRange;
}

export interface DisplayFinding {
  ruleId: string;
  severity: "error" | "warning" | "info";
  fromTurnNumber: number;
  toTurnNumber: number;
  evidence: string;
  /** Full range preserved (D-004) in every output path, including the terminal view. */
  costImpact?: CostImpactRange;
  /** Labeled counterfactual assumptions the range spans — shipped in --json/--md. */
  assumptions?: string[];
}

export interface SessionReportEntry {
  sessionId: string;
  title: string | null;
  turnCount: number;
  findings: DisplayFinding[];
  cost: CostSummary;
}

export interface Report {
  sessionsAnalyzed: number;
  totalFindings: number;
  flaggedSessions: SessionReportEntry[];
}
