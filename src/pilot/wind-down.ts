/**
 * Phase 3 Task 3: builds the wind-down advisory text. Deliberately never
 * mentions a model name or a `/model` switch — the spec is explicit that a
 * mid-session parent model switch is exactly what LENS's cache-nuke rule
 * flags, and PILOT must not recommend committing its own lint violation.
 * This is enforced by wind-down.test.ts's self-lint test, not just this
 * comment: it regex-scans rendered output across many fixture inputs.
 */

import type { PlanItem } from "./plan-items";

export const WIND_DOWN_THRESHOLD_PERCENT = 75;

export interface WindDownAdvisory {
  fired: boolean;
  lines: string[];
}

export function buildAdvisory(usedPercentage: number, planItems: PlanItem[] | null): WindDownAdvisory {
  if (usedPercentage < WIND_DOWN_THRESHOLD_PERCENT) {
    return { fired: false, lines: [] };
  }

  const lines: string[] = [
    `sessionlint: 5h quota at ${Math.round(usedPercentage)}% — consider winding down this session.`,
  ];

  if (planItems && planItems.length > 0) {
    const mechanical = planItems.filter((i) => i.classification === "mechanical");
    const heavy = planItems.filter((i) => i.classification === "heavy");
    if (mechanical.length > 0) {
      lines.push(`  ${mechanical.length} remaining item(s) look mechanical — good candidates to delegate to a subagent.`);
    }
    if (heavy.length > 0) {
      lines.push(`  ${heavy.length} remaining item(s) look substantial — consider deferring these to a fresh session.`);
    }
  } else {
    lines.push("  Consider delegating remaining mechanical work to a subagent, or wrapping up before the window resets.");
  }

  return { fired: true, lines };
}

export function renderAdvisory(advisory: WindDownAdvisory): string {
  return advisory.lines.join("\n");
}
