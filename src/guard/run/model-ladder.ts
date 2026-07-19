/**
 * Core model-ladder logic: try the cheapest model first, escalate on
 * failure. "Failure" is defined ONLY by the success-check command's exit
 * code, never by Claude's own self-reported result — see types.ts. Injects
 * ClaudeRunner/SuccessChecker so this is fully unit-testable without any
 * real, billed API calls (see claude-runner.ts for the real implementation,
 * which is deliberately kept out of this file's test surface).
 */

import type { ClaudeRunner, LadderRungResult, RunProfile, RunResult, SuccessChecker } from "./types";

export async function runModelLadder(
  prompt: string,
  cwd: string,
  profile: RunProfile,
  runner: ClaudeRunner,
  checker: SuccessChecker
): Promise<RunResult> {
  const rungs: LadderRungResult[] = [];

  for (const model of profile.modelLadder) {
    const claudeResult = await runner.run({
      prompt,
      model,
      cwd,
      budgetUsd: profile.budgetUsd,
      permissionMode: profile.permissionMode,
      timeoutMs: profile.timeoutMs,
    });

    if (claudeResult.isError) {
      rungs.push({
        model,
        costUsd: claudeResult.totalCostUsd,
        isError: true,
        successCheckExitCode: null,
        succeeded: false,
        durationMs: claudeResult.durationMs,
      });
      continue;
    }

    const checkResult = await checker.check({ command: profile.successCheck, cwd });
    const succeeded = checkResult.exitCode === 0;
    rungs.push({
      model,
      costUsd: claudeResult.totalCostUsd,
      isError: false,
      successCheckExitCode: checkResult.exitCode,
      succeeded,
      durationMs: claudeResult.durationMs,
    });

    if (succeeded) break;
  }

  return {
    succeeded: rungs.length > 0 && rungs[rungs.length - 1]!.succeeded,
    rungs,
    totalCostUsd: rungs.reduce((sum, r) => sum + r.costUsd, 0),
  };
}
