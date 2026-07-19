export interface CostSourceResult {
  costUsd: number;
  /** false when no local session data could be found for this project at all. */
  dataFound: boolean;
}

export interface CostSource {
  costSince(cwd: string, sinceMs: number): Promise<CostSourceResult>;
}

export interface CommitSource {
  getHeadCommit(cwd: string): Promise<string | null>;
}

export type LoopStopReason =
  | "overall-budget"
  | "per-iter-budget"
  | "max-iters"
  | "requested-by-caller"
  | `watchdog:${string}`;

export interface LoopOptions {
  command: string[];
  cwd: string;
  budgetUsd?: number;
  perIterBudgetUsd?: number;
  maxIters?: number;
  pollIntervalMs?: number;
  gracefulTimeoutMs?: number;
  nowMs?: () => number;
  /** Optional: run this after each detected iteration (new commit) to check test status, for
   * the watchdog's repeated-error detector. No test-command means that detector never fires. */
  testCommand?: string[];
  watchdog?: import("../watchdog/types").WatchdogConfig;
}

export interface LoopResult {
  exitCode: number | null;
  signalCode: string | null;
  stopReason: LoopStopReason | null;
  iterationsCompleted: number;
  handoffNoteWritten: boolean;
  notified: boolean;
  /** Path to the persisted run-log JSON (Task 5's morning-after report source), or null if
   * persistence itself failed — never blocks the loop's own result on a report-writing error. */
  runLogPath: string | null;
}
