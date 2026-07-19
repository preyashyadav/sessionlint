import { describe, expect, test } from "bun:test";
import { renderSpotCheckSection, renderVerifyReportTerminal } from "./render";
import type { VerifyReport } from "./report";
import type { ThreeTierResult } from "../judge/types";

function makeReport(overrides: Partial<VerifyReport> = {}): VerifyReport {
  return {
    totalNominated: 10,
    totalSampled: 8,
    totalExcluded: 2,
    totalJudged: 8,
    perStratum: [
      {
        stratum: "large",
        nominatedCount: 10,
        sampledCount: 8,
        equivalentCount: 6,
        equivalenceRateCI: { low: 0.4, high: 0.9 },
        savingsRangeUsd: { low: 1.5, high: 3.2 },
      },
      { stratum: "small", nominatedCount: 0, sampledCount: 0, equivalentCount: 0, equivalenceRateCI: { low: 0, high: 1 }, savingsRangeUsd: null },
      { stratum: "medium", nominatedCount: 0, sampledCount: 0, equivalentCount: 0, equivalenceRateCI: { low: 0, high: 1 }, savingsRangeUsd: null },
    ],
    overallEquivalenceRateCI: { low: 0.4, high: 0.9 },
    totalSavingsRangeUsd: { low: 1.5, high: 3.2 },
    callFailures: [],
    skippedAfterAuthFailure: 0,
    recommendation: "Test recommendation line.",
    methodologyNotes: ["Note one.", "Note two."],
    ...overrides,
  };
}

describe("renderVerifyReportTerminal", () => {
  test("includes header, per-stratum line, overall summary, recommendation, and methodology", () => {
    const output = renderVerifyReportTerminal(makeReport());
    expect(output).toContain("10 candidates nominated");
    expect(output).toContain("large");
    expect(output).toContain("6/8 judged");
    expect(output).toContain("Recommendation: Test recommendation line.");
    expect(output).toContain("Note one.");
    expect(output).toContain("Note two.");
  });

  test("omits empty strata from the per-stratum listing", () => {
    const output = renderVerifyReportTerminal(makeReport());
    expect(output).not.toContain("small ");
    expect(output).not.toContain("medium ");
  });

  test("TP: zero judged — no CI/savings numbers rendered, honest 'not estimated' lines instead", () => {
    const output = renderVerifyReportTerminal(
      makeReport({
        totalJudged: 0,
        totalSavingsRangeUsd: null,
        perStratum: [
          {
            stratum: "medium",
            nominatedCount: 1,
            sampledCount: 0,
            equivalentCount: 0,
            equivalenceRateCI: { low: 0, high: 1 },
            savingsRangeUsd: null,
          },
        ],
      })
    );
    expect(output).toContain("0 judged (of 1 nominated)");
    expect(output).toContain("equivalence and savings not estimated");
    // The vacuous 0%-100% CI and a dollar range must NOT appear anywhere.
    expect(output).not.toContain("0%-100%");
    expect(output).not.toContain("savings $");
  });

  test("TP: call failures render as a visible section with the per-turn message and skip note", () => {
    const output = renderVerifyReportTerminal(
      makeReport({
        callFailures: [{ sessionId: "9bb10a7c-0f28-4516", turnId: "turn-5", message: "401 authentication_error" }],
        skippedAfterAuthFailure: 2,
      })
    );
    expect(output).toContain("1 of 8 replay/judge call(s) FAILED");
    expect(output).toContain("9bb10a7c:turn-5 — 401 authentication_error");
    expect(output).toContain("2 remaining call(s) skipped");
  });

  test("TN: a clean report renders no failure section", () => {
    expect(renderVerifyReportTerminal(makeReport())).not.toContain("FAILED");
  });
});

describe("renderSpotCheckSection", () => {
  const result: ThreeTierResult = {
    sessionId: "s1",
    turnId: "t1",
    mechanical: { verdict: "pass", reasons: [] },
    llmJudge: null,
    finalVerdict: "uncertain",
  };

  test("collapsed by default", () => {
    const output = renderSpotCheckSection([result], new Map());
    expect(output).toContain("1 borderline case");
    expect(output).toContain("pass --full to expand");
  });

  test("expanded shows original vs replayed text", () => {
    const texts = new Map([["s1:t1", { original: "Original text.", replayed: "Replayed text." }]]);
    const output = renderSpotCheckSection([result], texts, true);
    expect(output).toContain("original: Original text.");
    expect(output).toContain("replayed: Replayed text.");
  });

  test("no borderline cases: says so plainly", () => {
    expect(renderSpotCheckSection([], new Map())).toContain("No borderline");
  });
});
