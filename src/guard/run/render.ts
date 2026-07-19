import type { RunResult } from "./types";

/** Machine-readable export for CI (Task 6's GitHub Action job artifact) — same convention as
 * LENS's renderJson (src/report/json.ts): no reshaping, RunResult is already serializable. */
export function renderRunResultJson(result: RunResult): string {
  return JSON.stringify(result, null, 2);
}

export function renderRunResult(result: RunResult): string {
  const lines: string[] = [];
  for (const rung of result.rungs) {
    const status = rung.isError ? "CLI error" : rung.succeeded ? "success" : `success-check failed (exit ${rung.successCheckExitCode})`;
    lines.push(`  ${rung.model}: ${status} — $${rung.costUsd.toFixed(4)}`);
  }
  lines.push(
    result.succeeded
      ? `sessionlint run: succeeded (total $${result.totalCostUsd.toFixed(4)})`
      : `sessionlint run: FAILED — ladder exhausted (total $${result.totalCostUsd.toFixed(4)})`
  );
  return lines.join("\n");
}
