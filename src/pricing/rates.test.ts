import { describe, expect, test } from "bun:test";
import { checkStaleness, getModelRate, STALENESS_WARNING_DAYS } from "./rates";
import { PRICING_TABLE, type PricingTable } from "./table";

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

  test("a model with no effectiveUntil is never flagged expired", () => {
    const rate = getModelRate("claude-opus-4-8", new Date("2099-01-01"));
    expect(rate?.introRateExpired).toBe(false);
  });

  // The intro-rate mechanism is exercised against an INJECTED table, not against whichever
  // real model happens to carry an intro rate this month. These tests used to bind to
  // Sonnet 5's scheduled 2026-09-01 increase; when that increase was cancelled they failed
  // for a reason that had nothing to do with the behavior they were meant to protect.
  // No model in the shipped table carries an intro rate today — the machinery stays covered
  // here so it still works for the next one that does.
  const introTable: PricingTable = {
    retrievedAt: "2026-01-01",
    sourceUrl: "https://example.com",
    models: {
      "claude-intro": {
        inputPerMTok: 2,
        outputPerMTok: 10,
        effectiveUntil: "2026-08-31",
        postIntroRate: { inputPerMTok: 3, outputPerMTok: 15 },
      },
    },
  };

  test("intro rate still applies inside the window", () => {
    const r = getModelRate("claude-intro", new Date("2026-08-01"), introTable);
    expect(r?.inputPerMTok).toBe(2.0);
    expect(r?.outputPerMTok).toBe(10.0);
    expect(r?.introRateExpired).toBe(false);
  });

  test("standard rate takes over automatically once the intro window closes", () => {
    const r = getModelRate("claude-intro", new Date("2026-09-01"), introTable);
    expect(r?.inputPerMTok).toBe(3.0);
    expect(r?.outputPerMTok).toBe(15.0);
    expect(r?.introRateExpired).toBe(true);
    expect(r?.introRateExpiredWithoutReplacement).toBe(false); // published replacement exists
  });

  test("derived cache rates follow the post-intro input rate, not the stale intro one", () => {
    const r = getModelRate("claude-intro", new Date("2026-09-01"), introTable);
    expect(r?.cacheWrite5mPerMTok).toBeCloseTo(3.75, 5); // 3.0 * 1.25
    expect(r?.cacheWrite1hPerMTok).toBeCloseTo(6.0, 5); // 3.0 * 2
    expect(r?.cacheReadPerMTok).toBeCloseTo(0.3, 5); // 3.0 * 0.1
  });

  // Regression, D-009 (paired with the table-level test): the real Sonnet 5 must NOT
  // reprice itself on 2026-09-01. This is the failure the cancelled increase would have
  // caused — a silent 50% overstatement on the most-used model, with no warning.
  test("real sonnet-5 bills $2/$10 on both sides of the cancelled 2026-09-01 boundary", () => {
    for (const when of ["2026-08-01", "2026-09-01", "2027-01-01"]) {
      const r = getModelRate("claude-sonnet-5", new Date(when));
      expect(r?.inputPerMTok, when).toBe(2.0);
      expect(r?.outputPerMTok, when).toBe(10.0);
      expect(r?.introRateExpired, when).toBe(false);
    }
  });

  test("an expired intro rate with NO published replacement keeps the old rate and flags it", () => {
    const table: PricingTable = {
      retrievedAt: "2026-01-01",
      sourceUrl: "https://example.com",
      models: { "claude-hypothetical": { inputPerMTok: 1, outputPerMTok: 5, effectiveUntil: "2026-02-01" } },
    };
    const r = getModelRate("claude-hypothetical", new Date("2026-03-01"), table);
    expect(r?.inputPerMTok).toBe(1); // never invent a replacement rate
    expect(r?.introRateExpiredWithoutReplacement).toBe(true);
  });
});

describe("getModelRate: fast mode", () => {
  const AS_OF = new Date("2026-08-14");

  test("TP — speed:'fast' on a model with published fast pricing bills the fast rate", () => {
    const r = getModelRate("claude-opus-5", AS_OF, PRICING_TABLE, { speed: "fast" });
    expect(r?.inputPerMTok).toBe(10.0);
    expect(r?.outputPerMTok).toBe(50.0);
    expect(r?.fastModeApplied).toBe(true);
    // Cache multipliers stack on top of fast-mode pricing, not on the base rate.
    expect(r?.cacheWrite5mPerMTok).toBeCloseTo(12.5, 5); // 10.0 * 1.25
    expect(r?.cacheWrite1hPerMTok).toBeCloseTo(20.0, 5); // 10.0 * 2
    expect(r?.cacheReadPerMTok).toBeCloseTo(1.0, 5); // 10.0 * 0.1
  });

  test("TN — speed:'standard' bills the base rate", () => {
    const r = getModelRate("claude-opus-5", AS_OF, PRICING_TABLE, { speed: "standard" });
    expect(r?.inputPerMTok).toBe(5.0);
    expect(r?.fastModeApplied).toBe(false);
  });

  test("TN — no modifiers at all bills the base rate", () => {
    const r = getModelRate("claude-opus-5", AS_OF);
    expect(r?.inputPerMTok).toBe(5.0);
    expect(r?.fastModeApplied).toBe(false);
  });

  // Opus 4.6 accepts `speed: "fast"` but bills at standard rates. Charging a premium
  // there would be inventing a price the vendor does not publish (D-004).
  test("TN — speed:'fast' on a model without published fast pricing bills the base rate", () => {
    const r = getModelRate("claude-opus-4-6", AS_OF, PRICING_TABLE, { speed: "fast" });
    expect(r?.inputPerMTok).toBe(5.0);
    expect(r?.fastModeApplied).toBe(false);
  });
});

describe("getModelRate: inference geography", () => {
  const AS_OF = new Date("2026-08-14");

  test("TP — inference_geo:'us' applies the 1.1x premium to every category", () => {
    const r = getModelRate("claude-opus-5", AS_OF, PRICING_TABLE, { inferenceGeo: "us" });
    expect(r?.inputPerMTok).toBeCloseTo(5.5, 5); // 5.0 * 1.1
    expect(r?.outputPerMTok).toBeCloseTo(27.5, 5); // 25.0 * 1.1
    expect(r?.cacheWrite5mPerMTok).toBeCloseTo(6.875, 5); // 5.5 * 1.25
    expect(r?.cacheReadPerMTok).toBeCloseTo(0.55, 5); // 5.5 * 0.1
    expect(r?.inferenceGeoUsApplied).toBe(true);
  });

  test("TN — 'global' and 'not_available' bill at standard rates", () => {
    for (const geo of ["global", "not_available"]) {
      const r = getModelRate("claude-opus-5", AS_OF, PRICING_TABLE, { inferenceGeo: geo });
      expect(r?.inputPerMTok, geo).toBe(5.0);
      expect(r?.inferenceGeoUsApplied, geo).toBe(false);
    }
  });

  test("the residency premium stacks on top of fast-mode pricing", () => {
    const r = getModelRate("claude-opus-5", AS_OF, PRICING_TABLE, { speed: "fast", inferenceGeo: "us" });
    expect(r?.inputPerMTok).toBeCloseTo(11.0, 5); // 10.0 fast * 1.1
    expect(r?.outputPerMTok).toBeCloseTo(55.0, 5); // 50.0 fast * 1.1
    expect(r?.fastModeApplied).toBe(true);
    expect(r?.inferenceGeoUsApplied).toBe(true);
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
