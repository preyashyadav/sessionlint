import { describe, expect, test } from "bun:test";
import { checkStaleness, getModelRate, STALENESS_WARNING_DAYS } from "./rates";
import type { PricingTable } from "./table";

describe("getModelRate", () => {
  test("returns derived cache rates for a known model", () => {
    const rate = getModelRate("claude-opus-4-8", new Date("2026-07-10"));
    expect(rate).not.toBeNull();
    expect(rate?.inputPerMTok).toBe(5.0);
    expect(rate?.cacheWrite5mPerMTok).toBeCloseTo(6.25, 5); // 5.0 * 1.25
    expect(rate?.cacheWrite1hPerMTok).toBeCloseTo(10.0, 5); // 5.0 * 2
    expect(rate?.cacheReadPerMTok).toBeCloseTo(0.5, 5); // 5.0 * 0.1
  });

  test("returns null for an unknown model (never throws, never defaults to zero silently)", () => {
    expect(getModelRate("claude-hypothetical-future-model")).toBeNull();
  });

  test("intro rate not yet expired before its effectiveUntil date", () => {
    const rate = getModelRate("claude-sonnet-5", new Date("2026-08-01"));
    expect(rate?.introRateExpired).toBe(false);
  });

  test("intro rate flagged expired after its effectiveUntil date", () => {
    const rate = getModelRate("claude-sonnet-5", new Date("2026-09-01"));
    expect(rate?.introRateExpired).toBe(true);
  });

  test("a model with no effectiveUntil is never flagged expired", () => {
    const rate = getModelRate("claude-opus-4-8", new Date("2099-01-01"));
    expect(rate?.introRateExpired).toBe(false);
  });
});

describe("checkStaleness", () => {
  const table: PricingTable = { retrievedAt: "2026-01-01", sourceUrl: "https://example.com", models: {} };

  test("not stale within the warning window", () => {
    const result = checkStaleness(table, new Date("2026-01-15"));
    expect(result.daysSince).toBe(14);
    expect(result.stale).toBe(false);
  });

  test(`fires exactly after ${STALENESS_WARNING_DAYS} days`, () => {
    const atBoundary = checkStaleness(table, new Date("2026-01-22")); // 21 days
    expect(atBoundary.daysSince).toBe(STALENESS_WARNING_DAYS);
    expect(atBoundary.stale).toBe(false); // "after 21 days", not "at"

    const pastBoundary = checkStaleness(table, new Date("2026-01-23")); // 22 days
    expect(pastBoundary.daysSince).toBe(STALENESS_WARNING_DAYS + 1);
    expect(pastBoundary.stale).toBe(true);
  });
});
