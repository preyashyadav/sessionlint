import { describe, expect, test } from "bun:test";
import { buildAdvisory, renderAdvisory, WIND_DOWN_THRESHOLD_PERCENT } from "./wind-down";
import type { PlanItem } from "./plan-items";

// Self-lint: the spec is explicit that a mid-session parent /model switch is
// exactly what LENS's own cache-nuke rule flags — PILOT must never
// recommend committing its own lint violation. This regex catches any
// mention of the /model command or a model name, in any advisory output.
const MODEL_SWITCH_LANGUAGE = /\/model\b|\bswitch(ed|ing)?\s+(to\s+)?(the\s+)?model\b|\bopus\b|\bsonnet\b|\bhaiku\b|\bfable\b/i;

describe("buildAdvisory", () => {
  test("below threshold does not fire", () => {
    const advisory = buildAdvisory(WIND_DOWN_THRESHOLD_PERCENT - 1, null);
    expect(advisory.fired).toBe(false);
    expect(advisory.lines).toEqual([]);
  });

  test("at or above threshold fires", () => {
    expect(buildAdvisory(WIND_DOWN_THRESHOLD_PERCENT, null).fired).toBe(true);
    expect(buildAdvisory(100, null).fired).toBe(true);
  });

  test("no plan file gives generic delegation/deferral advice", () => {
    const advisory = buildAdvisory(90, null);
    expect(renderAdvisory(advisory)).toContain("delegating");
  });

  test("plan items split into mechanical (delegate) and heavy (defer) call-outs", () => {
    const planItems: PlanItem[] = [
      { text: "Fix typo", classification: "mechanical" },
      { text: "Refactor engine", classification: "heavy" },
    ];
    const rendered = renderAdvisory(buildAdvisory(90, planItems));
    expect(rendered).toContain("mechanical");
    expect(rendered).toContain("substantial");
  });

  test("self-lint: no advisory output ever mentions a model name or /model switch", () => {
    const scenarios: Array<[number, PlanItem[] | null]> = [
      [0, null],
      [50, null],
      [75, null],
      [90, null],
      [100, null],
      [90, []],
      [90, [{ text: "Fix a typo", classification: "mechanical" }]],
      [90, [{ text: "Refactor the opus of work", classification: "heavy" }]], // adversarial: plan text itself contains "opus"
      [90, [
        { text: "Fix typo", classification: "mechanical" },
        { text: "Refactor engine", classification: "heavy" },
      ]],
    ];
    for (const [usedPercentage, planItems] of scenarios) {
      const rendered = renderAdvisory(buildAdvisory(usedPercentage, planItems));
      expect(rendered).not.toMatch(MODEL_SWITCH_LANGUAGE);
    }
  });
});
