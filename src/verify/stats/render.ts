/** Terminal renderer for a VerifyReport (Phase 2, Task 5's "report" half). */

import type { ThreeTierResult } from "../judge/types";
import type { VerifyReport } from "./report";

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function renderVerifyReportTerminal(report: VerifyReport): string {
  const lines: string[] = [];

  lines.push(
    `sessionlint --verify · ${report.totalNominated} candidates nominated · ${report.totalSampled} sampled · ` +
      `${report.totalExcluded} excluded`
  );
  lines.push("");

  lines.push("  Per-stratum equivalence (95% Wilson CI) and extrapolated savings:");
  for (const s of report.perStratum) {
    if (s.nominatedCount === 0) continue;
    if (s.sampledCount === 0 || s.savingsRangeUsd === null) {
      lines.push(
        `    ${s.stratum.padEnd(8)} 0 judged (of ${s.nominatedCount} nominated) — no equivalence data, savings not estimated`
      );
      continue;
    }
    lines.push(
      `    ${s.stratum.padEnd(8)} ${s.equivalentCount}/${s.sampledCount} judged · ` +
        `equivalence ${pct(s.equivalenceRateCI.low)}-${pct(s.equivalenceRateCI.high)} · ` +
        `savings ${fmtUsd(s.savingsRangeUsd.low)}-${fmtUsd(s.savingsRangeUsd.high)} ` +
        `(of ${s.nominatedCount} nominated)`
    );
  }
  lines.push("");

  if (report.callFailures.length > 0) {
    lines.push(
      `  ⚠ ${report.callFailures.length} of ${report.totalSampled} replay/judge call(s) FAILED — no verdict for these turns:`
    );
    for (const f of report.callFailures) {
      lines.push(`    - ${f.sessionId.slice(0, 8)}:${f.turnId} — ${f.message.slice(0, 200)}`);
    }
    if (report.skippedAfterAuthFailure > 0) {
      lines.push(
        `    ${report.skippedAfterAuthFailure} remaining call(s) skipped: an authentication failure ` +
          "fails every call identically. Failed auth incurs no API charges."
      );
    }
    lines.push("");
  }

  if (report.totalSavingsRangeUsd === null) {
    lines.push(`  Overall: 0 of ${report.totalSampled} sampled turn(s) judged — equivalence and savings not estimated.`);
  } else {
    lines.push(
      `  Overall equivalence: ${pct(report.overallEquivalenceRateCI.low)}-${pct(report.overallEquivalenceRateCI.high)} · ` +
        `total savings range: ${fmtUsd(report.totalSavingsRangeUsd.low)}-${fmtUsd(report.totalSavingsRangeUsd.high)}`
    );
  }
  lines.push("");
  lines.push(`  Recommendation: ${report.recommendation}`);
  lines.push("");

  lines.push("  Methodology:");
  for (const note of report.methodologyNotes) lines.push(`    - ${note}`);

  return lines.join("\n");
}

/** Spot-check section — collapsed by default (evidence only), expandable to show the full
 * original vs. replayed text per borderline case ("expandable diffs" per the phase spec). */
export function renderSpotCheckSection(
  borderline: ThreeTierResult[],
  originalAndReplayedByKey: Map<string, { original: string; replayed: string }>,
  expandDiffs = false
): string {
  if (borderline.length === 0) return "  No borderline (uncertain) cases to spot-check.";

  const lines: string[] = [`  ${borderline.length} borderline case(s) for human spot-check:`];
  for (const result of borderline) {
    const key = `${result.sessionId}:${result.turnId}`;
    lines.push(`    - ${key} (turn ${result.turnId})`);
    if (expandDiffs) {
      const texts = originalAndReplayedByKey.get(key);
      if (texts) {
        lines.push(`        original: ${texts.original}`);
        lines.push(`        replayed: ${texts.replayed}`);
      }
    } else {
      lines.push("        (pass --full to expand original vs. replayed text)");
    }
  }
  return lines.join("\n");
}
