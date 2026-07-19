/**
 * Phase 4 Task 3 core: `sessionlint loop -- <cmd>` wraps an arbitrary opaque
 * child (reusing Task 1's generic supervisor) and polls two independently
 * sourced signals — cumulative $ spend (project-cost.ts, via local JSONL,
 * no cooperation needed from the child) and new git commits (treated as
 * iteration boundaries, an ASSUMPTION about loop-runner convention, not a
 * verified fact — see git-iterations.ts). CostSource/CommitSource are
 * injected so this is fully unit-testable without touching real git state
 * or real Claude Code session history.
 */

import { appendHandoffNote } from "../handoff-note";
import { startSupervisedProcess } from "../process-supervisor";
import { sendDesktopNotification } from "../../pilot/desktop-notify";
import { evaluateWatchdog } from "../watchdog/detectors";
import { buildTestOutputSignature } from "../watchdog/real-diff-source";
import type { DiffSource, IterationRecord } from "../watchdog/types";
import type { TestCommandRunner } from "../watchdog/test-command-runner";
import { classifyWaste, diffStat } from "../report/waste";
import { estimateWatchdogSavings } from "../report/savings";
import { writeRunLog } from "../report/persist";
import type { IterationReportEntry, RunLog } from "../report/types";
import type { CommitSource, CostSource, LoopOptions, LoopResult, LoopStopReason } from "./types";

const noopDiffSource: DiffSource = { async diffBetween() { return ""; } };

export async function runLoop(
  options: LoopOptions,
  costSource: CostSource,
  commitSource: CommitSource,
  diffSource: DiffSource = noopDiffSource,
  testCommandRunner?: TestCommandRunner
): Promise<LoopResult> {
  const pollIntervalMs = options.pollIntervalMs ?? 30_000;
  const nowMs = options.nowMs ?? (() => Date.now());
  const loopStartMs = nowMs();

  let lastSeenCommit = await commitSource.getHeadCommit(options.cwd);
  let iterationStartMs = loopStartMs;
  let iterationsCompleted = 0;
  let pollsSinceLastCommit = 0;
  let stopReason: LoopStopReason | null = null;
  const history: IterationRecord[] = [];
  const reportEntries: IterationReportEntry[] = [];
  let previousDiffText: string | null = null;

  const handle = startSupervisedProcess({
    command: options.command,
    cwd: options.cwd,
    gracefulTimeoutMs: options.gracefulTimeoutMs,
  });

  let childExited = false;
  void handle.exited.then(() => {
    childExited = true;
  });

  while (!childExited) {
    await Promise.race([Bun.sleep(pollIntervalMs), handle.exited]);
    if (childExited) break;

    if (options.budgetUsd !== undefined) {
      const overall = await costSource.costSince(options.cwd, loopStartMs);
      if (overall.dataFound && overall.costUsd >= options.budgetUsd) {
        stopReason = "overall-budget";
        await handle.requestStop(`overall budget of $${options.budgetUsd.toFixed(2)} exceeded`);
        break;
      }
    }

    const currentCommit = await commitSource.getHeadCommit(options.cwd);
    if (currentCommit && currentCommit !== lastSeenCommit) {
      iterationsCompleted++;
      pollsSinceLastCommit = 0;

      // Report data (diff/test/cost) is always collected, independent of --watchdog — the
      // morning-after report (Task 5) is useful even for a loop that never enabled the
      // watchdog. Only the TRIP EVALUATION below stays gated behind options.watchdog.
      const diffText = await diffSource.diffBetween(options.cwd, lastSeenCommit, currentCommit);
      let testExitCode: number | null = null;
      let testOutputSignature: string | null = null;
      if (options.testCommand && testCommandRunner) {
        const testResult = await testCommandRunner.run(options.testCommand, options.cwd);
        testExitCode = testResult.exitCode;
        testOutputSignature = buildTestOutputSignature(testResult.output);
      }
      history.push({ commit: currentCommit, diffText, testExitCode, testOutputSignature });

      const iterCost = await costSource.costSince(options.cwd, iterationStartMs);
      const stat = diffStat(diffText);
      const wasteReason = classifyWaste(diffText, testExitCode, previousDiffText);
      reportEntries.push({
        index: iterationsCompleted,
        commit: currentCommit,
        costUsd: iterCost.dataFound ? iterCost.costUsd : null,
        linesAdded: stat.linesAdded,
        linesRemoved: stat.linesRemoved,
        testExitCode,
        wasted: wasteReason !== null,
        wasteReason,
      });
      previousDiffText = diffText;

      lastSeenCommit = currentCommit;
      iterationStartMs = nowMs();

      if (options.maxIters !== undefined && iterationsCompleted >= options.maxIters) {
        stopReason = "max-iters";
        await handle.requestStop(`reached max-iters (${options.maxIters})`);
        break;
      }

      if (options.watchdog) {
        const tripped = evaluateWatchdog(history, pollsSinceLastCommit, options.watchdog);
        if (tripped) {
          stopReason = `watchdog:${tripped}`;
          await handle.requestStop(`watchdog tripped: ${tripped}`);
          break;
        }
      }
      continue; // a fresh iteration just started — the per-iter check below doesn't apply yet
    }

    pollsSinceLastCommit++;
    if (options.watchdog && evaluateWatchdog(history, pollsSinceLastCommit, options.watchdog) === "no-new-commits") {
      stopReason = "watchdog:no-new-commits";
      await handle.requestStop(`watchdog tripped: no-new-commits (${pollsSinceLastCommit} polls with no new commit)`);
      break;
    }

    if (options.perIterBudgetUsd !== undefined) {
      const perIter = await costSource.costSince(options.cwd, iterationStartMs);
      if (perIter.dataFound && perIter.costUsd >= options.perIterBudgetUsd) {
        stopReason = "per-iter-budget";
        await handle.requestStop(`per-iteration budget of $${options.perIterBudgetUsd.toFixed(2)} exceeded`);
        break;
      }
    }
  }

  // One last check in case a final commit landed between the last poll and the child's exit.
  if (!stopReason) {
    const finalCommit = await commitSource.getHeadCommit(options.cwd);
    if (finalCommit && finalCommit !== lastSeenCommit) iterationsCompleted++;
  }

  const exitInfo = await handle.exited;
  const handoffNoteWritten = stopReason
    ? await appendHandoffNote(options.cwd, {
        timestamp: new Date(nowMs()).toISOString(),
        reason: stopReason,
        stoppedGracefully: exitInfo.signalCode !== "SIGKILL",
        exitCode: exitInfo.exitCode,
        lastOutputLines: [],
      })
    : false;

  // Notification is scoped to watchdog trips specifically (the spec's "on trip: pause, write
  // diagnosis, notify" is under the watchdog, not the plain budget/max-iters stops).
  const notified = stopReason?.startsWith("watchdog:")
    ? await sendDesktopNotification("sessionlint loop", `Stopped: ${stopReason}`)
    : false;

  const overallCost = await costSource.costSince(options.cwd, loopStartMs);
  const totalCostUsd = overallCost.dataFound ? overallCost.costUsd : null;
  const watchdogSavings = stopReason?.startsWith("watchdog:")
    ? estimateWatchdogSavings(reportEntries, totalCostUsd, options.budgetUsd ?? null, options.maxIters ?? null)
    : null;

  const runLog: RunLog = {
    runStartedAt: new Date(loopStartMs).toISOString(),
    runEndedAt: new Date(nowMs()).toISOString(),
    projectDir: options.cwd,
    command: options.command,
    budgetUsd: options.budgetUsd ?? null,
    perIterBudgetUsd: options.perIterBudgetUsd ?? null,
    maxIters: options.maxIters ?? null,
    stopReason,
    exitCode: exitInfo.exitCode,
    totalCostUsd,
    iterations: reportEntries,
    watchdogSavings,
  };

  // A run-log write failure (disk full, permissions) must never take down the loop's own
  // result — the loop already finished; reporting is a best-effort side artifact.
  let runLogPath: string | null = null;
  try {
    runLogPath = await writeRunLog(runLog);
  } catch {
    runLogPath = null;
  }

  return {
    exitCode: exitInfo.exitCode,
    signalCode: exitInfo.signalCode,
    stopReason,
    iterationsCompleted,
    handoffNoteWritten,
    notified,
    runLogPath,
  };
}
