import { formatCostRange, formatUsdRangeOuter, ruleLabel, severityGlyph, turnRangeLabel } from "./format";
import type { Report } from "./types";

export function renderMarkdown(report: Report): string {
  const lines: string[] = [];

  lines.push("# sessionlint report");
  lines.push("");
  lines.push(
    `${report.sessionsAnalyzed} session(s) analyzed · ${report.totalFindings} finding(s) across ` +
      `${report.flaggedSessions.length} flagged session(s).`
  );
  lines.push("");

  for (const session of report.flaggedSessions) {
    const heading = session.title ? `${session.title} (${session.sessionId.slice(0, 8)})` : session.sessionId.slice(0, 8);
    lines.push(`## ${heading}`);
    lines.push("");
    const couldHaveBeen = session.cost.couldHaveBeen
      ? ` (could plausibly have been ~${formatUsdRangeOuter(session.cost.couldHaveBeen.low, session.cost.couldHaveBeen.high)})`
      : "";
    lines.push(
      `${session.turnCount.toLocaleString()} turns · API-equivalent cost: $${session.cost.estimated.toFixed(2)}${couldHaveBeen}`
    );
    lines.push("");

    for (const finding of session.findings) {
      const glyph = severityGlyph(finding.severity);
      const range = turnRangeLabel(finding.fromTurnNumber, finding.toTurnNumber);
      const costSuffix = finding.costImpact ? ` — cost impact range: ${formatCostRange(finding.costImpact)}` : "";
      lines.push(`- ${glyph} **${ruleLabel(finding.ruleId)}** ${range}${costSuffix}`);
      lines.push(`  ${finding.evidence}`);
      if (finding.assumptions && finding.assumptions.length > 0) {
        lines.push(`  - _range assumptions:_ ${finding.assumptions.join("; ")}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}
