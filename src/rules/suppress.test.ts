import { describe, expect, test } from "bun:test";
import { applySuppression } from "./suppress";
import type { Finding } from "./types";

function makeFinding(ruleId: string): Finding {
  return { ruleId, severity: "warning", turnRange: { fromTurnId: "t1", toTurnId: "t1" }, evidence: "x" };
}

describe("applySuppression", () => {
  test("no suppression: all findings pass through unchanged", () => {
    const findings = [makeFinding("a"), makeFinding("b")];
    expect(applySuppression(findings, [])).toEqual(findings);
  });

  test("filters out findings matching a suppressed rule id", () => {
    const findings = [makeFinding("cache-nuke"), makeFinding("late-compaction"), makeFinding("cache-nuke")];
    const result = applySuppression(findings, ["cache-nuke"]);
    expect(result).toHaveLength(1);
    expect(result[0]?.ruleId).toBe("late-compaction");
  });

  test("suppressing an id with no matching findings is a no-op", () => {
    const findings = [makeFinding("a")];
    expect(applySuppression(findings, ["nonexistent"])).toEqual(findings);
  });
});
