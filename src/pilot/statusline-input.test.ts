import { describe, expect, test } from "bun:test";
import { parseStatusLineInput } from "./statusline-input";

describe("parseStatusLineInput", () => {
  test("parses a valid five_hour + seven_day payload", () => {
    const input = parseStatusLineInput({
      rate_limits: {
        five_hour: { used_percentage: 12, resets_at: 1783738800 },
        seven_day: { used_percentage: 5, resets_at: 1783803600 },
      },
    });
    expect(input.rateLimits?.fiveHour).toEqual({ usedPercentage: 12, resetsAt: 1783738800 });
    expect(input.rateLimits?.sevenDay).toEqual({ usedPercentage: 5, resetsAt: 1783803600 });
  });

  test("missing rate_limits (non-subscriber or pre-first-response) degrades gracefully, not a throw", () => {
    // session_id is still parsed even with no rate_limits — metered/API-key users (Task 5's
    // credits sentinel audience) are exactly the population with no rate_limits at all.
    expect(parseStatusLineInput({ session_id: "abc" })).toEqual({ sessionId: "abc" });
    expect(parseStatusLineInput({})).toEqual({});
  });

  test("parses cost.total_cost_usd and session_id, independent of rate_limits", () => {
    const input = parseStatusLineInput({ session_id: "abc", cost: { total_cost_usd: 6.67 } });
    expect(input).toEqual({ sessionId: "abc", totalCostUsd: 6.67 });
  });

  test("malformed cost object is dropped, not crashed on", () => {
    expect(parseStatusLineInput({ cost: { total_cost_usd: "not a number" } })).toEqual({});
    expect(parseStatusLineInput({ cost: "not an object" })).toEqual({});
  });

  test("null/non-object input degrades to empty", () => {
    expect(parseStatusLineInput(null)).toEqual({});
    expect(parseStatusLineInput("not json")).toEqual({});
    expect(parseStatusLineInput(42)).toEqual({});
  });

  test("one window present, other absent — both are independently optional", () => {
    const input = parseStatusLineInput({
      rate_limits: { five_hour: { used_percentage: 3, resets_at: 100 } },
    });
    expect(input.rateLimits?.fiveHour).toEqual({ usedPercentage: 3, resetsAt: 100 });
    expect(input.rateLimits?.sevenDay).toBeUndefined();
  });

  test("malformed window (wrong field types) is dropped, not crashed on", () => {
    const input = parseStatusLineInput({
      rate_limits: { five_hour: { used_percentage: "12%", resets_at: 100 } },
    });
    expect(input.rateLimits?.fiveHour).toBeUndefined();
  });

  test("ignores undocumented fields like fast_mode without erroring", () => {
    const input = parseStatusLineInput({
      fast_mode: true,
      rate_limits: { five_hour: { used_percentage: 1, resets_at: 100 } },
    });
    expect(input.rateLimits?.fiveHour?.usedPercentage).toBe(1);
  });
});
