import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { loadLastRunLog, loadRunLog, writeRunLog } from "./persist";
import type { RunLog } from "./types";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "sessionlint-report-persist-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function sampleRunLog(projectDir: string, endedAt: string): RunLog {
  return {
    runStartedAt: "2026-07-13T00:00:00.000Z",
    runEndedAt: endedAt,
    projectDir,
    command: ["bash", "loop.sh"],
    budgetUsd: null,
    perIterBudgetUsd: null,
    maxIters: 5,
    stopReason: "max-iters",
    exitCode: 0,
    totalCostUsd: 1.23,
    iterations: [],
    watchdogSavings: null,
  };
}

describe("writeRunLog / loadRunLog", () => {
  test("round-trips a run log to disk under <projectDir>/.sessionlint/loop-runs/", async () => {
    await withTempDir(async (dir) => {
      const runLog = sampleRunLog(dir, "2026-07-13T01:00:00.000Z");
      const path = await writeRunLog(runLog);
      expect(path).toContain(join(".sessionlint", "loop-runs"));
      const loaded = await loadRunLog(path);
      expect(loaded).toEqual(runLog);
    });
  });
});

describe("loadLastRunLog", () => {
  test("returns null when no run log exists yet — not an error", async () => {
    await withTempDir(async (dir) => {
      expect(await loadLastRunLog(dir)).toBeNull();
    });
  });

  test("returns the most recently written run log by ended-at ordering", async () => {
    await withTempDir(async (dir) => {
      await writeRunLog(sampleRunLog(dir, "2026-07-13T01:00:00.000Z"));
      await writeRunLog(sampleRunLog(dir, "2026-07-13T03:00:00.000Z"));
      await writeRunLog(sampleRunLog(dir, "2026-07-13T02:00:00.000Z"));
      const last = await loadLastRunLog(dir);
      expect(last?.runLog.runEndedAt).toBe("2026-07-13T03:00:00.000Z");
    });
  });
});
