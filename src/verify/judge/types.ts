export type MechanicalVerdict = "pass" | "fail";
export type LlmVerdict = "equivalent" | "not-equivalent";
export type JudgeVerdict = LlmVerdict | "uncertain";
export type FinalVerdict = JudgeVerdict | "mechanical-fail";

export interface MechanicalCheckResult {
  verdict: MechanicalVerdict;
  /** Human-readable reasons for a fail — empty when verdict is "pass". */
  reasons: string[];
}

export interface LlmJudgeResult {
  verdict: JudgeVerdict;
  /** Verdict with original presented first. */
  orderAVerdict: LlmVerdict;
  /** Verdict with replayed presented first (positions swapped) — position-bias control. */
  orderBVerdict: LlmVerdict;
}

export interface ThreeTierResult {
  sessionId: string;
  turnId: string;
  mechanical: MechanicalCheckResult;
  /** null when T1 failed — a T1 fail is final, the LLM judge is never invoked (Phase 2 spec). */
  llmJudge: LlmJudgeResult | null;
  finalVerdict: FinalVerdict;
}

/** Injectable — hides which response is "original" vs "replayed" from the judge model
 * (the caller must never leak that labeling into the prompt). No real implementation
 * exists in this codebase; only fakes, per the phase's "mocked API" test gate. */
export interface JudgeClient {
  judge(request: { taskPrompt: string; responseA: string; responseB: string }): Promise<LlmVerdict>;
}
