import { describe, expect, test } from "bun:test";
import { applySuppression, buildAliasIndex } from "./suppress";
import type { Finding, Rule } from "./types";

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

describe("applySuppression: rule-ID aliasing", () => {
  const renamedRule: Rule = {
    id: "new-name",
    aliases: ["old-name"],
    detector: () => [],
    fixDocUrl: "x",
    suppressible: true,
  };
  const aliasIndex = buildAliasIndex([renamedRule]);

  test("suppressing by a former (alias) id filters the renamed rule's findings", () => {
    const findings = [makeFinding("new-name"), makeFinding("other")];
    expect(applySuppression(findings, ["old-name"], aliasIndex).map((f) => f.ruleId)).toEqual(["other"]);
  });

  test("suppressing by the current id still works with an alias index present", () => {
    const findings = [makeFinding("new-name"), makeFinding("other")];
    expect(applySuppression(findings, ["new-name"], aliasIndex).map((f) => f.ruleId)).toEqual(["other"]);
  });

  test("no alias index: canonical-id match only (former id does not resolve)", () => {
    const findings = [makeFinding("new-name")];
    expect(applySuppression(findings, ["old-name"])).toEqual(findings);
    expect(applySuppression(findings, ["new-name"])).toHaveLength(0);
  });
});
