import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, copyFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { FakeApiClient } from "./replay/client";
import type { JudgeClient } from "./judge/types";
import { runVerify } from "./run";

const SYNTHETIC_DIR = join(import.meta.dir, "..", "..", "fixtures", "synthetic");
const AS_OF = new Date("2026-07-10");

const fakeApiClient = new FakeApiClient((request) => ({
  content: [{ type: "text", text: `Echo: ${request.messages.at(-1)?.content ?? ""}` }],
  usage: { input_tokens: 20, output_tokens: 10 },
  stopReason: "end_turn",
}));

const fakeJudgeClient: JudgeClient = {
  judge: async ({ responseA, responseB }) => (responseA.trim() === responseB.trim() ? "equivalent" : "not-equivalent"),
};

let fixtureRoot: string;

beforeEach(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), "sessionlint-verify-"));
});

afterEach(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

async function seedProjectWith(fixtureFile: string): Promise<void> {
  const projectDir = join(fixtureRoot, "test-project");
  await mkdir(projectDir, { recursive: true });
  await copyFile(join(SYNTHETIC_DIR, fixtureFile), join(projectDir, fixtureFile));
}

describe("runVerify: paranoid refusal (checked before any discovery)", () => {
  test("--paranoid refuses outright, never touches the API client or confirm prompt", async () => {
    let confirmCalled = false;
    const result = await runVerify({
      root: fixtureRoot, // empty — proves paranoid short-circuits before discovery even runs
      paranoid: true,
      apiClient: fakeApiClient,
      judgeClient: fakeJudgeClient,
      confirm: async () => {
        confirmCalled = true;
        return true;
      },
      now: AS_OF,
    });

    expect(result.outcome).toBe("paranoid-refused");
    expect(confirmCalled).toBe(false);
  });
});

describe("runVerify: no candidates", () => {
  test("an empty project root produces the no-candidates outcome, not a crash", async () => {
    const result = await runVerify({
      root: fixtureRoot,
      paranoid: false,
      apiClient: fakeApiClient,
      judgeClient: fakeJudgeClient,
      confirm: async () => true,
      now: AS_OF,
    });
    expect(result.outcome).toBe("no-candidates");
  });
});

describe("runVerify: user declines the cost preview", () => {
  test("declining stops before any replay/judge call is made", async () => {
    await seedProjectWith("model-switch.jsonl");

    let apiCalled = false;
    const countingApiClient = new FakeApiClient(() => {
      apiCalled = true;
      return { content: [], usage: { input_tokens: 0, output_tokens: 0 }, stopReason: "end_turn" };
    });

    let previewMessageSeen = "";
    const result = await runVerify({
      root: fixtureRoot,
      paranoid: false,
      apiClient: countingApiClient,
      judgeClient: fakeJudgeClient,
      confirm: async (message) => {
        previewMessageSeen = message;
        return false;
      },
      now: AS_OF,
    });

    expect(result.outcome).toBe("declined");
    expect(apiCalled).toBe(false);
    expect(previewMessageSeen).toContain("replay call");
    expect(previewMessageSeen).toContain("Estimated replay cost");
  });
});

describe("runVerify: user confirms, full pipeline completes", () => {
  test("proceeds through replay + judge + report when confirmed", async () => {
    await seedProjectWith("model-switch.jsonl");

    const result = await runVerify({
      root: fixtureRoot,
      paranoid: false,
      apiClient: fakeApiClient,
      judgeClient: fakeJudgeClient,
      confirm: async () => true,
      now: AS_OF,
    });

    expect(result.outcome).toBe("completed");
    expect(result.report).toBeDefined();
    expect(result.report?.totalSampled).toBeGreaterThan(0);
    expect(result.rendered).toContain("candidates nominated");
  });

  test("a single failing replay call is skipped, not fatal to the whole run", async () => {
    await seedProjectWith("model-switch.jsonl");
    await seedProjectWith("missing-clear.jsonl");

    const failingClient = new FakeApiClient(() => {
      throw new Error("simulated transient failure");
    });

    const result = await runVerify({
      root: fixtureRoot,
      paranoid: false,
      apiClient: failingClient,
      judgeClient: fakeJudgeClient,
      confirm: async () => true,
      now: AS_OF,
    });

    // Every candidate's replay call fails, but the pipeline still completes with an empty
    // (rather than crashed) judge result set.
    expect(result.outcome).toBe("completed");
    expect(result.report?.overallEquivalenceRateCI).toEqual({ low: 0, high: 1 });
  });
});

describe("runVerify: call failures are reported, never silently swallowed", () => {
  test("TP: transient failures are recorded per candidate and surfaced in the rendered report", async () => {
    await seedProjectWith("model-switch.jsonl");

    const failingClient = new FakeApiClient(() => {
      throw new Error("simulated transient failure");
    });

    const result = await runVerify({
      root: fixtureRoot,
      paranoid: false,
      apiClient: failingClient,
      judgeClient: fakeJudgeClient,
      confirm: async () => true,
      now: AS_OF,
    });

    expect(result.outcome).toBe("completed");
    expect(result.report?.callFailures.length).toBeGreaterThan(0);
    expect(result.report?.callFailures[0]?.message).toContain("simulated transient failure");
    expect(result.report?.totalJudged).toBe(0);
    expect(result.report?.totalSavingsRangeUsd).toBeNull();
    expect(result.rendered).toContain("FAILED");
    expect(result.rendered).toContain("simulated transient failure");
    expect(result.rendered).toContain("equivalence and savings not estimated");
    expect(result.report?.recommendation).toContain("failed");
    expect(result.report?.recommendation).not.toContain("run --verify");
  });

  test("TP: an auth failure aborts the remaining calls instead of repeating the same error", async () => {
    // Two fixture sessions so more than one candidate can be sampled.
    await seedProjectWith("model-switch.jsonl");
    await seedProjectWith("missing-clear.jsonl");

    let apiCalls = 0;
    const authFailingClient = new FakeApiClient(() => {
      apiCalls++;
      const err = new Error("401 authentication_error: invalid x-api-key") as Error & { status: number };
      err.status = 401;
      throw err;
    });

    const result = await runVerify({
      root: fixtureRoot,
      paranoid: false,
      apiClient: authFailingClient,
      judgeClient: fakeJudgeClient,
      confirm: async () => true,
      now: AS_OF,
    });

    expect(result.outcome).toBe("completed");
    expect(apiCalls).toBe(1);
    expect(result.report?.callFailures).toHaveLength(1);
    const sampled = result.report?.totalSampled ?? 0;
    expect(result.report?.skippedAfterAuthFailure).toBe(sampled - 1);
    if (sampled > 1) {
      expect(result.rendered).toContain("remaining call(s) skipped");
    }
  });

  test("TP: a missing-key SDK message (no status field) is also treated as an auth failure", async () => {
    await seedProjectWith("model-switch.jsonl");
    await seedProjectWith("missing-clear.jsonl");

    let apiCalls = 0;
    const missingKeyClient = new FakeApiClient(() => {
      apiCalls++;
      throw new Error("The ANTHROPIC_API_KEY environment variable is missing or empty");
    });

    const result = await runVerify({
      root: fixtureRoot,
      paranoid: false,
      apiClient: missingKeyClient,
      judgeClient: fakeJudgeClient,
      confirm: async () => true,
      now: AS_OF,
    });

    expect(apiCalls).toBe(1);
    expect(result.report?.callFailures).toHaveLength(1);
  });

  test("TN: a fully successful run reports zero failures and renders no failure section", async () => {
    await seedProjectWith("model-switch.jsonl");

    const result = await runVerify({
      root: fixtureRoot,
      paranoid: false,
      apiClient: fakeApiClient,
      judgeClient: fakeJudgeClient,
      confirm: async () => true,
      now: AS_OF,
    });

    expect(result.report?.callFailures).toEqual([]);
    expect(result.report?.skippedAfterAuthFailure).toBe(0);
    expect(result.rendered).not.toContain("FAILED");
  });

  test("TN: a transient (non-auth) failure does NOT abort the remaining calls", async () => {
    await seedProjectWith("model-switch.jsonl");
    await seedProjectWith("missing-clear.jsonl");

    let apiCalls = 0;
    const flakyClient = new FakeApiClient((request) => {
      apiCalls++;
      if (apiCalls === 1) throw new Error("529 overloaded_error");
      return {
        content: [{ type: "text", text: `Echo: ${request.messages.at(-1)?.content ?? ""}` }],
        usage: { input_tokens: 20, output_tokens: 10 },
        stopReason: "end_turn",
      };
    });

    const result = await runVerify({
      root: fixtureRoot,
      paranoid: false,
      apiClient: flakyClient,
      judgeClient: fakeJudgeClient,
      confirm: async () => true,
      now: AS_OF,
    });

    const sampled = result.report?.totalSampled ?? 0;
    expect(apiCalls).toBe(sampled); // every candidate attempted, no early abort
    expect(result.report?.callFailures).toHaveLength(1);
    expect(result.report?.skippedAfterAuthFailure).toBe(0);
    if (sampled > 1) {
      expect(result.report?.totalJudged).toBe(sampled - 1);
    }
  });
});
