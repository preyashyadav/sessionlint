/** Terminal renderer (C-4) — structure matches README v0's mock: header, one
 * divider-boxed block per flagged session (title/turn count, findings with
 * glyph/rule/turn-range/cost, wrapped evidence, explain link, session cost
 * line), then a footer summary. */

import { formatCostRangeShort, formatUsdRangeOuter, ruleLabel, severityGlyph, turnRangeLabel, wrapText } from "./format";
import type { Report } from "./types";

const DIVIDER = "━".repeat(67);

export function renderTerminal(report: Report): string {
  const lines: string[] = [];

  const sessionWord = report.sessionsAnalyzed === 1 ? "session" : "sessions";
  lines.push(`sessionlint · ${report.sessionsAnalyzed} ${sessionWord} analyzed`);
  lines.push("");

  for (const session of report.flaggedSessions) {
    lines.push(DIVIDER);
    const titlePart = session.title ? ` "${session.title}"` : "";
    lines.push(`  session  ${session.sessionId.slice(0, 8)}${titlePart}  ${session.turnCount.toLocaleString()} turns`);
    lines.push(DIVIDER);
    lines.push("");

    for (const finding of session.findings) {
      const glyph = severityGlyph(finding.severity);
      const label = ruleLabel(finding.ruleId);
      const range = turnRangeLabel(finding.fromTurnNumber, finding.toTurnNumber);
      const cost = formatCostRangeShort(finding.costImpact);
      lines.push(`  ${glyph} ${label.padEnd(22)} ${range.padEnd(24)} ${cost}`);
      for (const evidenceLine of wrapText(finding.evidence)) {
        lines.push(`    ${evidenceLine}`);
      }
      lines.push(`    → sessionlint explain ${finding.ruleId}`);
      lines.push("");
    }

    // No cost-quantified findings ⇒ omit the clause entirely — never a point that merely
    // echoes the estimate (D-004; the exact bug this replaced).
    const couldHaveBeen = session.cost.couldHaveBeen;
    const couldHaveBeenClause = couldHaveBeen
      ? ` · could plausibly have been ~${formatUsdRangeOuter(couldHaveBeen.low, couldHaveBeen.high)}`
      : "";
    lines.push(`  session cost: $${session.cost.estimated.toFixed(2)} API-equivalent${couldHaveBeenClause}`);
    lines.push("");
  }

  lines.push(DIVIDER);
  const findingWord = report.totalFindings === 1 ? "finding" : "findings";
  const flaggedWord = report.flaggedSessions.length === 1 ? "session" : "sessions";
  lines.push(
    `  ${report.totalFindings} ${findingWord} across ${report.flaggedSessions.length} flagged ${flaggedWord} · ` +
      "replay-audit with: sessionlint --verify"
  );
  lines.push(DIVIDER);

  return lines.join("\n");
}
