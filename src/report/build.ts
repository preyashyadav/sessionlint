import type { LoadedSession } from "../adapters/claude-code/session";
import type { Session } from "../adapters/claude-code/types";
import { computeSessionCost } from "../cost/compute";
import { ALL_RULES } from "../rules";
import { applySuppression, buildAliasIndex } from "../rules/suppress";
import type { Finding } from "../rules/types";
import type { DisplayFinding, Report, SessionReportEntry } from "./types";
import { sanitizeDisplayText } from "./sanitize";

export interface BuildReportOptions {
  suppressedRuleIds?: Iterable<string>;
  asOf?: Date;
}

function extractTitle(session: Session): string | null {
  let title: string | null = null;
  for (const turn of session.turns) {
    for (const entry of turn.entries) {
      const raw = entry.raw as { type?: unknown; aiTitle?: unknown };
      if (raw.type === "ai-title" && typeof raw.aiTitle === "string" && raw.aiTitle.length > 0) {
        title = sanitizeDisplayText(raw.aiTitle);
      }
    }
  }
  return title;
}

export function buildReport(loaded: LoadedSession[], options: BuildReportOptions = {}): Report {
  const asOf = options.asOf ?? new Date();
  const suppressed = options.suppressedRuleIds ?? [];
  const aliasIndex = buildAliasIndex(ALL_RULES);
  const flaggedSessions: SessionReportEntry[] = [];
  let totalFindings = 0;

  for (const { session } of loaded) {
    const turnDisplayNumber = new Map(session.turns.map((t, i) => [t.turnId, i + 1]));

    let findings: Finding[] = [];
    for (const rule of ALL_RULES) findings.push(...rule.detector(session));
    findings = applySuppression(findings, suppressed, aliasIndex);
    if (findings.length === 0) continue;

    const cost = computeSessionCost(session, asOf);
    // Session-level range: low subtracts the findings' HIGH bounds, high subtracts their lows.
    // Individual finding lows can be negative (cache-nuke's net-save case) — clamp per finding
    // so a negative low never inflates the session's "could have been" above its actual cost.
    const avoidableLow = findings.reduce((sum, f) => sum + Math.max(0, f.costImpact?.low ?? 0), 0);
    const avoidableHigh = findings.reduce((sum, f) => sum + Math.max(0, f.costImpact?.high ?? 0), 0);

    const displayFindings: DisplayFinding[] = findings.map((f) => ({
      ruleId: f.ruleId,
      severity: f.severity,
      fromTurnNumber: turnDisplayNumber.get(f.turnRange.fromTurnId) ?? 0,
      toTurnNumber: turnDisplayNumber.get(f.turnRange.toTurnId) ?? 0,
      evidence: f.evidence,
      costImpact: f.costImpact,
      assumptions: f.assumptions,
    }));

    flaggedSessions.push({
      sessionId: session.sessionId,
      title: extractTitle(session),
      turnCount: session.turns.length,
      findings: displayFindings,
      cost: {
        estimated: cost.totalCost,
        // Absent (not a zero-width range) when nothing was cost-quantified (D-004).
        couldHaveBeen:
          avoidableHigh > 0
            ? {
                low: Math.max(0, cost.totalCost - avoidableHigh),
                high: Math.max(0, cost.totalCost - avoidableLow),
              }
            : undefined,
      },
    });
    totalFindings += findings.length;
  }

  return { sessionsAnalyzed: loaded.length, totalFindings, flaggedSessions };
}
