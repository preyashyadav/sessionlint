/**
 * Phase 4 Task 5's "hero artifact" — renders a persisted RunLog into the
 * morning-after summary: per-iteration timeline, waste breakdown, and (when
 * the watchdog tripped) a "saved ~$X-$Y" range, never a point estimate.
 */

import type { RunLog } from "./types";

function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function renderMorningReport(runLog: RunLog): string {
  const lines: string[] = [];
  lines.push("sessionlint report — morning-after summary");
  lines.push(`Run: ${runLog.runStartedAt} -> ${runLog.runEndedAt}`);
  lines.push(`Project: ${runLog.projectDir}`);
  lines.push(`Command: ${runLog.command.join(" ")}`);
  lines.push(`Stopped: ${runLog.stopReason ?? "child exited on its own"}`);
  lines.push("");

  if (runLog.iterations.length === 0) {
    lines.push("No iterations (commits) were detected during this run.");
    return lines.join("\n");
  }

  lines.push("Iteration timeline:");
  for (const it of runLog.iterations) {
    const cost = it.costUsd !== null ? formatUsd(it.costUsd) : "cost unknown";
    const diff = `+${it.linesAdded}/-${it.linesRemoved}`;
    const outcome = it.wasted ? `wasted (${it.wasteReason})` : "ok";
    lines.push(`  #${it.index}  ${it.commit.slice(0, 8)}  ${cost}  ${diff}  ${outcome}`);
  }
  lines.push("");

  const wastedIters = runLog.iterations.filter((it) => it.wasted);
  const wastedCostUsd = wastedIters.reduce((sum, it) => sum + (it.costUsd ?? 0), 0);
  const wasteSummary =
    `Waste breakdown: ${wastedIters.length} of ${runLog.iterations.length} iteration(s) wasted` +
    (runLog.totalCostUsd !== null
      ? ` (${formatUsd(wastedCostUsd)} of ${formatUsd(runLog.totalCostUsd)} total)`
      : "");
  lines.push(wasteSummary);

  if (runLog.watchdogSavings) {
    lines.push(
      `Watchdog saved an estimated ${formatUsd(runLog.watchdogSavings.lowUsd)}-` +
        `${formatUsd(runLog.watchdogSavings.highUsd)} by stopping here instead of continuing ` +
        "to the configured budget/max-iters limit."
    );
  }

  return lines.join("\n");
}
