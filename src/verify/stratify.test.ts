import { describe, expect, test } from "bun:test";
import { classifyTaskFamily, contextStratum } from "./stratify";

describe("contextStratum", () => {
  test("under 10k is small", () => {
    expect(contextStratum(0)).toBe("small");
    expect(contextStratum(9_999)).toBe("small");
  });

  test("10k-50k (inclusive) is medium", () => {
    expect(contextStratum(10_000)).toBe("medium");
    expect(contextStratum(50_000)).toBe("medium");
  });

  test("over 50k is large", () => {
    expect(contextStratum(50_001)).toBe("large");
    expect(contextStratum(1_000_000)).toBe("large");
  });
});

describe("classifyTaskFamily", () => {
  test("matches bugfix, test, refactor, docs, feature keywords", () => {
    expect(classifyTaskFamily("Fix the bug in auth.ts")).toBe("bugfix");
    expect(classifyTaskFamily("Add a test for the withdraw endpoint")).toBe("test");
    expect(classifyTaskFamily("Refactor the pricing module")).toBe("refactor");
    expect(classifyTaskFamily("Update the README docs")).toBe("docs");
    expect(classifyTaskFamily("Implement the new referral feature")).toBe("feature");
  });

  test("null or unmatched prompt text falls back to other", () => {
    expect(classifyTaskFamily(null)).toBe("other");
    expect(classifyTaskFamily("What time is it in Tokyo?")).toBe("other");
  });

  test("bugfix keyword wins over feature keyword when both present (earlier pattern wins)", () => {
    expect(classifyTaskFamily("Fix and add a feature")).toBe("bugfix");
  });
});
