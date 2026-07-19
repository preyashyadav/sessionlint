import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { buildCostPreview, runCommand } from "./run-command";
import type { ClaudeRunResult, ClaudeRunner, RunProfile, SuccessChecker } from "./types";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "sessionlint-runcmd-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const okResult: ClaudeRunResult = { isError: false, totalCostUsd: 0.02, numTurns: 1, durationMs: 100, resultText: "ok" };
const okRunner: ClaudeRunner = { async run() { return okResult; } };
const okChecker: SuccessChecker = { async check() { return { exitCode: 0 }; } };

const profile: RunProfile = { modelLadder: ["haiku"], successCheck: ["true"], permissionMode: "acceptEdits" };

describe("buildCostPreview", () => {
  test("mentions the ladder, budget, and success-check command", () => {
    const preview = buildCostPreview({ ...profile, modelLadder: ["haiku", "sonnet"], budgetUsd: 1.5 });
    expect(preview).toContain("haiku → sonnet");
    expect(preview).toContain("$1.50");
    expect(preview).toContain("true");
  });

  test("without a budget, says so plainly rather than a fake number", () => {
    const preview = buildCostPreview(profile);
    expect(preview).toContain("no per-rung budget cap set");
  });
});

describe("runCommand", () => {
  test("declining the confirm gate makes zero calls and writes no ledger entry", async () => {
    await withTempDir(async (dir) => {
      const ledgerPath = join(dir, "ledger.jsonl");
      let runnerCalled = false;
      const runner: ClaudeRunner = { async run() { runnerCalled = true; return okResult; } };
      const outcome = await runCommand({
        prompt: "do the thing",
        cwd: dir,
        profile,
        runner,
        checker: okChecker,
        ledgerPath,
        confirm: async () => false,
      });
      expect(outcome.outcome).toBe("declined");
      expect(runnerCalled).toBe(false);
      await expect(readFile(ledgerPath, "utf8")).rejects.toThrow();
    });
  });

  test("confirming runs the ladder and appends exactly one ledger entry", async () => {
    await withTempDir(async (dir) => {
      const ledgerPath = join(dir, "ledger.jsonl");
      const outcome = await runCommand({
        prompt: "do the thing",
        cwd: dir,
        profile,
        runner: okRunner,
        checker: okChecker,
        ledgerPath,
        confirm: async () => true,
        now: () => new Date("2026-07-13T00:00:00Z"),
      });
      expect(outcome.outcome).toBe("completed");
      if (outcome.outcome !== "completed") throw new Error("unreachable");
      expect(outcome.result.succeeded).toBe(true);

      const lines = (await readFile(ledgerPath, "utf8")).trim().split("\n");
      expect(lines).toHaveLength(1);
      const entry = JSON.parse(lines[0]!);
      expect(entry.timestamp).toBe("2026-07-13T00:00:00.000Z");
      expect(entry.result.succeeded).toBe(true);
    });
  });
});
