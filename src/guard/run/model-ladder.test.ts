import { describe, expect, test } from "bun:test";
import { runModelLadder } from "./model-ladder";
import type { ClaudeRunResult, ClaudeRunner, RunProfile, SuccessChecker } from "./types";

function fakeRunner(byModel: Record<string, ClaudeRunResult>): ClaudeRunner {
  return {
    async run({ model }) {
      const result = byModel[model];
      if (!result) throw new Error(`unexpected model in test: ${model}`);
      return result;
    },
  };
}

function fakeChecker(byModel: Record<string, number | null>, order: string[]): SuccessChecker {
  let i = 0;
  return {
    async check() {
      const model = order[i++]!;
      return { exitCode: byModel[model] ?? null };
    },
  };
}

function okResult(costUsd: number): ClaudeRunResult {
  return { isError: false, totalCostUsd: costUsd, numTurns: 1, durationMs: 100, resultText: "ok" };
}

const baseProfile: RunProfile = {
  modelLadder: ["haiku", "sonnet", "opus"],
  successCheck: ["npm", "test"],
  permissionMode: "acceptEdits",
};

describe("runModelLadder", () => {
  test("the first rung succeeding stops the ladder — no escalation", async () => {
    const runner = fakeRunner({ haiku: okResult(0.01), sonnet: okResult(0.05), opus: okResult(0.1) });
    const checker = fakeChecker({ haiku: 0 }, ["haiku"]);
    const result = await runModelLadder("fix the bug", "/tmp", baseProfile, runner, checker);
    expect(result.succeeded).toBe(true);
    expect(result.rungs).toHaveLength(1);
    expect(result.rungs[0]!.model).toBe("haiku");
    expect(result.totalCostUsd).toBeCloseTo(0.01);
  });

  test("a failed success check escalates to the next rung", async () => {
    const runner = fakeRunner({ haiku: okResult(0.01), sonnet: okResult(0.05), opus: okResult(0.1) });
    const checker = fakeChecker({ haiku: 1, sonnet: 0 }, ["haiku", "sonnet"]);
    const result = await runModelLadder("fix the bug", "/tmp", baseProfile, runner, checker);
    expect(result.succeeded).toBe(true);
    expect(result.rungs.map((r) => r.model)).toEqual(["haiku", "sonnet"]);
    expect(result.totalCostUsd).toBeCloseTo(0.06);
  });

  test("exhausting the whole ladder without success reports failure", async () => {
    const runner = fakeRunner({ haiku: okResult(0.01), sonnet: okResult(0.05), opus: okResult(0.1) });
    const checker = fakeChecker({ haiku: 1, sonnet: 1, opus: 1 }, ["haiku", "sonnet", "opus"]);
    const result = await runModelLadder("fix the bug", "/tmp", baseProfile, runner, checker);
    expect(result.succeeded).toBe(false);
    expect(result.rungs).toHaveLength(3);
    expect(result.totalCostUsd).toBeCloseTo(0.16);
  });

  test("a CLI-level error at a rung escalates without running the success check", async () => {
    let checkCalls = 0;
    const runner = fakeRunner({
      haiku: { isError: true, totalCostUsd: 0, numTurns: 0, durationMs: 10, resultText: "auth error" },
      sonnet: okResult(0.05),
    });
    const checker: SuccessChecker = {
      async check() {
        checkCalls++;
        return { exitCode: 0 };
      },
    };
    const result = await runModelLadder("fix the bug", "/tmp", baseProfile, runner, checker);
    expect(result.rungs[0]!.isError).toBe(true);
    expect(result.rungs[0]!.successCheckExitCode).toBeNull();
    expect(checkCalls).toBe(1); // only called for the sonnet rung, never for the errored haiku rung
    expect(result.succeeded).toBe(true);
  });
});
