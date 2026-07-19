import { describe, expect, test } from "bun:test";
import { classifyWaste, diffStat } from "./waste";

describe("diffStat", () => {
  test("counts + and - content lines, excluding file headers", () => {
    const diff = ["--- a/file.ts", "+++ b/file.ts", "@@ -1,2 +1,2 @@", "-old line", "+new line", "+another new line"].join("\n");
    expect(diffStat(diff)).toEqual({ linesAdded: 2, linesRemoved: 1 });
  });

  test("empty diff has zero stat", () => {
    expect(diffStat("")).toEqual({ linesAdded: 0, linesRemoved: 0 });
  });
});

describe("classifyWaste", () => {
  test("a failing test always counts as waste, regardless of diff", () => {
    expect(classifyWaste("some real change", 1, "different previous diff")).toBe("failing-test");
  });

  test("a passing test with a diff identical to the previous iteration is waste", () => {
    expect(classifyWaste("same diff", 0, "same diff")).toBe("identical-diff");
  });

  test("no test command configured (null exit code) and a genuinely new diff is not waste", () => {
    expect(classifyWaste("new diff", null, "old diff")).toBeNull();
  });

  test("the first iteration (no previous diff) is never waste on diff grounds alone", () => {
    expect(classifyWaste("first diff", null, null)).toBeNull();
  });

  test("an empty diff repeating (no real change at all) is not classified as identical-diff waste", () => {
    expect(classifyWaste("", 0, "")).toBeNull();
  });

  test("failing test takes priority over identical-diff when both are true", () => {
    expect(classifyWaste("same", 1, "same")).toBe("failing-test");
  });
});
