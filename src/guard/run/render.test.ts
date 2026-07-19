import { describe, expect, test } from "bun:test";
import { renderRunResult, renderRunResultJson } from "./render";
import type { RunResult } from "./types";

describe("renderRunResult", () => {
  test("a succeeding first rung renders success and total cost", () => {
    const result: RunResult = {
      succeeded: true,
      totalCostUsd: 0.02,
      rungs: [{ model: "haiku", costUsd: 0.02, isError: false, successCheckExitCode: 0, succeeded: true, durationMs: 100 }],
    };
    const rendered = renderRunResult(result);
    expect(rendered).toContain("haiku: success");
    expect(rendered).toContain("succeeded");
    expect(rendered).toContain("$0.0200");
  });

  test("an exhausted ladder renders FAILED with the failing exit codes", () => {
    const result: RunResult = {
      succeeded: false,
      totalCostUsd: 0.03,
      rungs: [
        { model: "haiku", costUsd: 0.01, isError: false, successCheckExitCode: 1, succeeded: false, durationMs: 100 },
        { model: "sonnet", costUsd: 0.02, isError: false, successCheckExitCode: 1, succeeded: false, durationMs: 100 },
      ],
    };
    const rendered = renderRunResult(result);
    expect(rendered).toContain("FAILED");
    expect(rendered).toContain("exit 1");
  });

  test("a CLI-level error rung is labeled distinctly from a failed success check", () => {
    const result: RunResult = {
      succeeded: false,
      totalCostUsd: 0,
      rungs: [{ model: "haiku", costUsd: 0, isError: true, successCheckExitCode: null, succeeded: false, durationMs: 10 }],
    };
    expect(renderRunResult(result)).toContain("CLI error");
  });
});

describe("renderRunResultJson", () => {
  test("round-trips the RunResult exactly, no reshaping", () => {
    const result: RunResult = {
      succeeded: true,
      totalCostUsd: 0.02,
      rungs: [{ model: "haiku", costUsd: 0.02, isError: false, successCheckExitCode: 0, succeeded: true, durationMs: 100 }],
    };
    expect(JSON.parse(renderRunResultJson(result))).toEqual(result);
  });
});
