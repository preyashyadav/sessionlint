import { describe, expect, test } from "bun:test";
import { join } from "path";
import { loadSession } from "../../adapters/claude-code/session";
import type { ThreeTierResult } from "../judge/types";
import { stratifiedSample } from "../sample";
import { computeRecommendation, buildVerifyReport, RECOMMENDATION_CONFIDENCE_THRESHOLD } from "./report";

const SYNTHETIC_DIR = join(import.meta.dir, "..", "..", "..", "fixtures", "synthetic");
const AS_OF = new Date("2026-07-10");

describe("computeRecommendation", () => {
  test("no judged turns, no failures: says plainly there is nothing to recommend", () => {
    const rec = computeRecommendation({ low: 0, high: 1 }, 0);
    expect(rec).toContain("nothing to recommend");
    // The old copy told the user to "run --verify" — inside a --verify run. Never again.
    expect(rec).not.toContain("run --verify");
  });

  test("no judged turns because calls failed: names the failure and the likely fix", () => {
    const rec = computeRecommendation({ low: 0, high: 1 }, 0, 1);
    expect(rec).toContain("failed");
    expect(rec).toContain("ANTHROPIC_API_KEY");
    expect(rec).toContain("no conclusion");
  });

  test("low bound clears the threshold: recommends the downgrade", () => {
    const rec = computeRecommendation({ low: RECOMMENDATION_CONFIDENCE_THRESHOLD, high: 0.95 }, 40);
    expect(rec).toContain("consider defaulting");
    expect(rec).toContain("70%");
  });

  test("low bound just under the threshold: no recommendation, but still concrete", () => {
    const rec = computeRecommendation({ low: RECOMMENDATION_CONFIDENCE_THRESHOLD - 0.01, high: 0.95 }, 40);
    expect(rec).toContain("doesn't clear a confident bar");
    expect(rec).not.toContain("consider defaulting");
  });
});

function makeJudgeResult(sessionId: string, turnId: string, finalVerdict: ThreeTierResult["finalVerdict"]): ThreeTierResult {
  return { sessionId, turnId, mechanical: { verdict: "pass", reasons: [] }, llmJudge: null, finalVerdict };
}

describe("buildVerifyReport: end-to-end over a real fixture", () => {
  test("missing-clear.jsonl's two large-stratum candidates roll up correctly", async () => {
    const loaded = [await loadSession(join(SYNTHETIC_DIR, "missing-clear.jsonl"))];
    const sampleResult = stratifiedSample(loaded);
    expect(sampleResult.sampled).toHaveLength(2); // both candidates survive exclusion

    const judgeResults = sampleResult.sampled.map((c, i) =>
      makeJudgeResult(c.sessionId, c.turnId, i === 0 ? "equivalent" : "not-equivalent")
    );

    const report = buildVerifyReport(loaded, sampleResult, judgeResults, AS_OF);

    expect(report.totalNominated).toBe(2);
    expect(report.totalSampled).toBe(2);
    expect(report.totalExcluded).toBe(0);

    const largeStratum = report.perStratum.find((s) => s.stratum === "large")!;
    expect(largeStratum.nominatedCount).toBe(2);
    expect(largeStratum.sampledCount).toBe(2);
    expect(largeStratum.equivalentCount).toBe(1);
    // 1/2 equivalence rate — Wilson CI must contain 0.5 (see wilson.test.ts's own property tests).
    expect(largeStratum.equivalenceRateCI.low).toBeLessThanOrEqual(0.5);
    expect(largeStratum.equivalenceRateCI.high).toBeGreaterThanOrEqual(0.5);

    // Savings range must be non-negative and low <= high.
    expect(largeStratum.savingsRangeUsd).not.toBeNull();
    expect(largeStratum.savingsRangeUsd!.low).toBeGreaterThanOrEqual(0);
    expect(largeStratum.savingsRangeUsd!.low).toBeLessThanOrEqual(largeStratum.savingsRangeUsd!.high);

    // Small/medium strata are present but empty (no candidates fell there) — nothing judged
    // there, so no savings range is claimed for them at all.
    const small = report.perStratum.find((s) => s.stratum === "small")!;
    expect(small.nominatedCount).toBe(0);
    expect(small.savingsRangeUsd).toBeNull();

    // Methodology footer discloses both replay limitations from Task 3.
    expect(report.methodologyNotes.some((n) => n.includes("system prompt"))).toBe(true);
    expect(report.methodologyNotes.some((n) => n.includes("tool_use"))).toBe(true);

    expect(report.recommendation.length).toBeGreaterThan(0);
  });

  test("no judge results at all: honest [0,1] CI, savings suppressed entirely (null, not $0)", async () => {
    const loaded = [await loadSession(join(SYNTHETIC_DIR, "missing-clear.jsonl"))];
    const sampleResult = stratifiedSample(loaded);
    const report = buildVerifyReport(loaded, sampleResult, [], AS_OF);

    expect(report.overallEquivalenceRateCI).toEqual({ low: 0, high: 1 });
    expect(report.totalJudged).toBe(0);
    expect(report.totalSavingsRangeUsd).toBeNull();
    expect(report.recommendation).toContain("nothing to recommend");
  });

  test("call failures flow into the report and swap the recommendation to the failure copy", async () => {
    const loaded = [await loadSession(join(SYNTHETIC_DIR, "missing-clear.jsonl"))];
    const sampleResult = stratifiedSample(loaded);
    const report = buildVerifyReport(loaded, sampleResult, [], AS_OF, {
      failures: [{ sessionId: "s1", turnId: "t1", message: "401 authentication_error" }],
      skippedAfterAuthFailure: 1,
    });

    expect(report.callFailures).toHaveLength(1);
    expect(report.skippedAfterAuthFailure).toBe(1);
    expect(report.recommendation).toContain("failed");
  });
});
