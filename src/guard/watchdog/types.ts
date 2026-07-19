/**
 * Phase 4 Task 4: convergence watchdog. Builds directly on Task 3's
 * commit-boundary signal — one IterationRecord per detected commit.
 */

export interface IterationRecord {
  commit: string;
  /** `git diff` text from the previous commit to this one — empty string if there was no
   * previous commit to diff against (the very first iteration). */
  diffText: string;
  /** null when no --test-command was configured for this loop. */
  testExitCode: number | null;
  /** A short, comparable signature of the test command's output (e.g. first N lines),
   * used to tell "the same failure repeating" apart from "different failures each time." */
  testOutputSignature: string | null;
}

export type WatchdogTripReason =
  | "no-new-commits"
  | "identical-diffs"
  | "oscillation"
  | "repeated-error";

export interface WatchdogConfig {
  /** Consecutive polls with no new commit before tripping. */
  noProgressPolls: number;
  /** Consecutive commits with byte-identical diffs before tripping (empty diffs don't count —
   * that means no changes at all, a different situation from "the same change repeating"). */
  identicalDiffIters: number;
  /** Consecutive iterations with the same failing test signature before tripping. */
  repeatedErrorIters: number;
}

export interface DiffSource {
  /** `git diff <from>..<to>` text, or "" if `from` is null (nothing to diff against yet). */
  diffBetween(cwd: string, from: string | null, to: string): Promise<string>;
}
