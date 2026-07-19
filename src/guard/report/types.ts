/**
 * Phase 4 Task 5: the morning-after report. A `RunLog` is the durable record
 * of one `sessionlint loop` invocation, written to disk on exit (any stop
 * reason, not just watchdog trips) so it survives past the terminal session
 * that started an overnight/unattended loop — the whole point of "morning
 * after." Rendering happens later, via `sessionlint report`, from this file.
 */

import type { LoopStopReason } from "../loop/types";

export interface IterationReportEntry {
  index: number; // 1-based
  commit: string;
  costUsd: number | null; // null when no cost data was found for this iteration (C-1 style)
  linesAdded: number;
  linesRemoved: number;
  testExitCode: number | null;
  /** True when this iteration is classified as waste: a failing test, or a diff byte-identical
   * to the immediately preceding iteration's diff (no real change). Never true for the first
   * iteration (nothing to compare against) unless its own test failed. */
  wasted: boolean;
  wasteReason: "failing-test" | "identical-diff" | null;
}

export interface WatchdogSavingsEstimate {
  lowUsd: number;
  highUsd: number;
}

export interface RunLog {
  runStartedAt: string; // ISO
  runEndedAt: string; // ISO
  projectDir: string;
  command: string[];
  budgetUsd: number | null;
  perIterBudgetUsd: number | null;
  maxIters: number | null;
  stopReason: LoopStopReason | null;
  exitCode: number | null;
  totalCostUsd: number | null; // null when no cost data was found at all
  iterations: IterationReportEntry[];
  /** null when the watchdog didn't trip, OR it did but no --budget/--max-iters was configured
   * to extrapolate remaining headroom against — never a guessed number (D-004/D-003 style). */
  watchdogSavings: WatchdogSavingsEstimate | null;
}
