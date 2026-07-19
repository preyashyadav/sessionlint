import { describe, expect, test } from "bun:test";
import { buildCreditsSentinelAdvisory, computeNewlyCrossedThresholds } from "./credits-sentinel";

const MODEL_SWITCH_LANGUAGE = /\/model\b|\bswitch(ed|ing)?\s+(to\s+)?(the\s+)?model\b|\bopus\b|\bsonnet\b|\bhaiku\b|\bfable\b/i;

describe("computeNewlyCrossedThresholds", () => {
  test("below 50% crosses nothing", () => {
    expect(computeNewlyCrossedThresholds(40, [])).toEqual([]);
  });

  test("crossing 60% fires only the 50% rung", () => {
    expect(computeNewlyCrossedThresholds(60, [])).toEqual([50]);
  });

  test("crossing 90% in one jump fires both 50 and 80, not 95", () => {
    expect(computeNewlyCrossedThresholds(90, [])).toEqual([50, 80]);
  });

  test("crossing 100% fires all three rungs", () => {
    expect(computeNewlyCrossedThresholds(100, [])).toEqual([50, 80, 95]);
  });

  test("a rung already fired does not fire again", () => {
    expect(computeNewlyCrossedThresholds(90, [50])).toEqual([80]);
    expect(computeNewlyCrossedThresholds(90, [50, 80])).toEqual([]);
  });
});

describe("buildCreditsSentinelAdvisory", () => {
  test("self-lint: never mentions a model name or /model switch", () => {
    for (const threshold of [50, 80, 95]) {
      const message = buildCreditsSentinelAdvisory(42.5, 50, threshold);
      expect(message).not.toMatch(MODEL_SWITCH_LANGUAGE);
    }
  });

  test("includes the spend, budget, and threshold", () => {
    const message = buildCreditsSentinelAdvisory(42.5, 50, 80);
    expect(message).toContain("$42.50");
    expect(message).toContain("$50.00");
    expect(message).toContain("80%");
  });
});
