import { describe, expect, test } from "bun:test";
import { selectBorderlineForSpotCheck } from "./spotcheck";
import type { ThreeTierResult } from "./types";

function makeResult(turnId: string, finalVerdict: ThreeTierResult["finalVerdict"]): ThreeTierResult {
  return {
    sessionId: "s1",
    turnId,
    mechanical: { verdict: "pass", reasons: [] },
    llmJudge: null,
    finalVerdict,
  };
}

describe("selectBorderlineForSpotCheck", () => {
  test("selects only uncertain verdicts", () => {
    const results = [
      makeResult("t1", "equivalent"),
      makeResult("t2", "uncertain"),
      makeResult("t3", "not-equivalent"),
      makeResult("t4", "mechanical-fail"),
      makeResult("t5", "uncertain"),
    ];
    const selected = selectBorderlineForSpotCheck(results);
    expect(selected.map((r) => r.turnId)).toEqual(["t2", "t5"]);
  });

  test("caps at n (default 5)", () => {
    const results = Array.from({ length: 10 }, (_, i) => makeResult(`t${i}`, "uncertain"));
    expect(selectBorderlineForSpotCheck(results)).toHaveLength(5);
    expect(selectBorderlineForSpotCheck(results, 2)).toHaveLength(2);
  });

  test("no uncertain results: empty selection", () => {
    const results = [makeResult("t1", "equivalent"), makeResult("t2", "not-equivalent")];
    expect(selectBorderlineForSpotCheck(results)).toEqual([]);
  });
});
