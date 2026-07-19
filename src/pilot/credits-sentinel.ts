/**
 * Phase 3 Task 5: warning ladder for metered/API-key spend against a locally
 * configured per-session budget. Same self-lint posture as wind-down.ts —
 * the advisory text never mentions a model name or /model switch.
 */

export const WARNING_LADDER_PERCENT = [50, 80, 95] as const;

export function computeNewlyCrossedThresholds(percentUsed: number, alreadyFired: number[]): number[] {
  return WARNING_LADDER_PERCENT.filter((t) => percentUsed >= t && !alreadyFired.includes(t));
}

export function buildCreditsSentinelAdvisory(spentUsd: number, budgetUsd: number, threshold: number): string {
  return (
    `sessionlint: $${spentUsd.toFixed(2)} spent of your $${budgetUsd.toFixed(2)} session budget ` +
    `(crossed ${threshold}%). Consider delegating remaining mechanical work to a subagent, ` +
    `or wrapping up at a checkpoint.`
  );
}
