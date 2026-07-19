/**
 * Parses TODO.md / plan.md-style markdown checklists into remaining
 * (unchecked) items, classified mechanical/heavy. This is a first-cut
 * keyword heuristic, not a trained classifier — Phase 3 Task 6's dogfood
 * week is where thresholds/keywords get tuned against real false alarms.
 *
 * Default-to-heavy on no keyword match is deliberate: under-recommending
 * delegation (a missed opportunity) is a safer failure mode than
 * over-recommending it (delegating real heavy work to a lighter model).
 */

export type PlanItemClassification = "mechanical" | "heavy";

export interface PlanItem {
  text: string;
  classification: PlanItemClassification;
}

const MECHANICAL_KEYWORDS = [
  "rename",
  "typo",
  "lint",
  "format",
  "docs",
  "documentation",
  "bump version",
  "add test",
  "cleanup",
  "clean up",
  "remove unused",
  "delete",
  "comment",
];

const HEAVY_KEYWORDS = [
  "design",
  "architect",
  "refactor",
  "migrate",
  "migration",
  "research",
  "investigate",
  "debug",
  "figure out",
  "decide",
  "plan",
  "security",
];

const CHECKBOX_LINE = /^\s*-\s*\[( |x|X)\]\s*(.+)$/;

export function classifyPlanItem(text: string): PlanItemClassification {
  const lower = text.toLowerCase();
  if (HEAVY_KEYWORDS.some((kw) => lower.includes(kw))) return "heavy";
  if (MECHANICAL_KEYWORDS.some((kw) => lower.includes(kw))) return "mechanical";
  return "heavy";
}

/** Parses a TODO.md/plan.md-style markdown checklist; returns only unchecked items. */
export function parsePlanItems(content: string): PlanItem[] {
  const items: PlanItem[] = [];
  for (const line of content.split("\n")) {
    const match = CHECKBOX_LINE.exec(line);
    if (!match) continue;
    const isChecked = match[1]!.toLowerCase() === "x";
    if (isChecked) continue;
    const text = match[2]!.trim();
    items.push({ text, classification: classifyPlanItem(text) });
  }
  return items;
}
