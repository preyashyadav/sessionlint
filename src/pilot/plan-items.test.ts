import { describe, expect, test } from "bun:test";
import { classifyPlanItem, parsePlanItems } from "./plan-items";

describe("classifyPlanItem", () => {
  test("heavy keywords classify as heavy", () => {
    expect(classifyPlanItem("Refactor the pricing engine")).toBe("heavy");
    expect(classifyPlanItem("Research the hook API")).toBe("heavy");
    expect(classifyPlanItem("Decide on a threshold")).toBe("heavy");
  });

  test("mechanical keywords classify as mechanical", () => {
    expect(classifyPlanItem("Fix a typo in the README")).toBe("mechanical");
    expect(classifyPlanItem("Rename the util function")).toBe("mechanical");
    expect(classifyPlanItem("Add test for the parser")).toBe("mechanical");
  });

  test("no keyword match defaults to heavy (conservative)", () => {
    expect(classifyPlanItem("Ship the new onboarding flow")).toBe("heavy");
  });

  test("heavy keyword wins if an item contains both signal types", () => {
    expect(classifyPlanItem("Refactor and rename the module")).toBe("heavy");
  });
});

describe("parsePlanItems", () => {
  test("parses unchecked checkbox lines only, skipping checked ones", () => {
    const content = [
      "# TODO",
      "- [x] Done: bump version",
      "- [ ] Refactor the parser",
      "- [X] Also done: fix typo",
      "- [ ] Add test for edge case",
      "Not a checklist line",
    ].join("\n");
    const items = parsePlanItems(content);
    expect(items).toEqual([
      { text: "Refactor the parser", classification: "heavy" },
      { text: "Add test for edge case", classification: "mechanical" },
    ]);
  });

  test("empty content returns an empty array, not an error", () => {
    expect(parsePlanItems("")).toEqual([]);
  });

  test("content with no checklist lines returns an empty array", () => {
    expect(parsePlanItems("# Just a heading\nSome prose.")).toEqual([]);
  });
});
