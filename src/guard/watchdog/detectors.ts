/**
 * Pure detector functions — no I/O, fully unit-testable against synthetic
 * iteration histories. `evaluateWatchdog` checks in a fixed priority order
 * so a single trip always reports one clear reason, not an ambiguous mix.
 */

import type { IterationRecord, WatchdogConfig, WatchdogTripReason } from "./types";

export function detectNoNewCommits(pollsSinceLastCommit: number, config: WatchdogConfig): boolean {
  return pollsSinceLastCommit >= config.noProgressPolls;
}

export function detectIdenticalDiffs(history: IterationRecord[], config: WatchdogConfig): boolean {
  if (history.length < config.identicalDiffIters) return false;
  const recent = history.slice(-config.identicalDiffIters);
  const first = recent[0]!.diffText;
  if (first.trim().length === 0) return false; // no real changes at all — a different situation
  return recent.every((r) => r.diffText === first);
}

/** A→B→A: the most recent commit's diff matches the one from two commits back, AND the
 * middle one genuinely differs — otherwise this is indistinguishable from "identical diffs
 * repeating" (A==B==C), which is detectIdenticalDiffs' job, not oscillation's. Without this
 * distinction the two detectors would trip on the exact same input in an ambiguous order. */
export function detectOscillation(history: IterationRecord[]): boolean {
  if (history.length < 3) return false;
  const a = history[history.length - 3]!;
  const b = history[history.length - 2]!;
  const c = history[history.length - 1]!;
  if (a.diffText.trim().length === 0) return false;
  return a.diffText === c.diffText && a.diffText !== b.diffText;
}

export function detectRepeatedError(history: IterationRecord[], config: WatchdogConfig): boolean {
  if (history.length < config.repeatedErrorIters) return false;
  const recent = history.slice(-config.repeatedErrorIters);
  if (!recent.every((r) => r.testExitCode !== null && r.testExitCode !== 0)) return false;
  const firstSignature = recent[0]!.testOutputSignature;
  if (firstSignature === null) return false;
  return recent.every((r) => r.testOutputSignature === firstSignature);
}

export function evaluateWatchdog(
  history: IterationRecord[],
  pollsSinceLastCommit: number,
  config: WatchdogConfig
): WatchdogTripReason | null {
  if (detectNoNewCommits(pollsSinceLastCommit, config)) return "no-new-commits";
  if (detectRepeatedError(history, config)) return "repeated-error";
  if (detectOscillation(history)) return "oscillation";
  if (detectIdenticalDiffs(history, config)) return "identical-diffs";
  return null;
}
