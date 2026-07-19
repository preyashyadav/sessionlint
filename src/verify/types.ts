/** A nominated turn — a candidate for the replay+judge pipeline to actually verify.
 * Nomination is a heuristic filter only; it never claims the turn WAS overpriced or
 * that a cheaper model WOULD have matched (D-005 spirit) — only that it's a plausible,
 * checkable candidate: no tool calls, pure text output, run on a premium-tier model. */
export interface CandidateTurn {
  sessionId: string;
  turnId: string;
  model: string;
  contextSizeAtTurn: number;
}

/** Context-size strata per the phase spec: <10k / 10-50k / >50k tokens. */
export type ContextStratum = "small" | "medium" | "large";

/** Coarse, heuristic task-family bucket — used only to diversify sampling, never
 * surfaced as a user-facing claim about what the turn "really" was. */
export type TaskFamily = "bugfix" | "test" | "refactor" | "docs" | "feature" | "other";

export interface StratifiedCandidate extends CandidateTurn {
  contextStratum: ContextStratum;
  taskFamily: TaskFamily;
}

export type ExclusionReasonKind = "secret-pattern-match" | "stateful-context-contamination";

export interface ExclusionReason {
  sessionId: string;
  turnId: string;
  reason: ExclusionReasonKind;
}

export interface SampleOptions {
  /** Default 40 per the phase spec, user-tunable. */
  n?: number;
}

export interface SampleResult {
  sampled: StratifiedCandidate[];
  excluded: ExclusionReason[];
}
