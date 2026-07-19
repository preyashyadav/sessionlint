/**
 * Pure functions — no I/O — for turning raw iteration signals (diff text,
 * test exit code) into the report's diffstat and waste classification.
 */

export interface DiffStat {
  linesAdded: number;
  linesRemoved: number;
}

/** Counts +/- content lines in a unified diff, excluding the `+++`/`---` file headers. */
export function diffStat(diffText: string): DiffStat {
  let linesAdded = 0;
  let linesRemoved = 0;
  for (const line of diffText.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) linesAdded++;
    else if (line.startsWith("-")) linesRemoved++;
  }
  return { linesAdded, linesRemoved };
}

export type WasteReason = "failing-test" | "identical-diff" | null;

/** An iteration is waste if its own test command failed, or its diff is byte-identical to the
 * immediately preceding iteration's diff (a real, non-empty change that accomplished nothing
 * new). `previousDiffText` is null for the first iteration — nothing to compare against. */
export function classifyWaste(
  diffText: string,
  testExitCode: number | null,
  previousDiffText: string | null
): WasteReason {
  if (testExitCode !== null && testExitCode !== 0) return "failing-test";
  if (previousDiffText !== null && diffText.trim().length > 0 && diffText === previousDiffText) {
    return "identical-diff";
  }
  return null;
}
