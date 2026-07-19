import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { runLoop } from "./loop-runner";
import { loadRunLog } from "../report/persist";
import type { CommitSource, CostSource } from "./types";
import type { DiffSource, WatchdogConfig } from "../watchdog/types";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "sessionlint-loop-report-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const RESPONSIVE_LONG_CHILD = ["bash", "-c", "trap 'exit 0' TERM; sleep 30 & wait \"$!\""];

function incrementingCommitSource(): CommitSource {
  let n = 0;
  return { async getHeadCommit() { n++; return `commit-${n}`; } };
}

function flatCost(costUsd: number): CostSource {
  return { async costSince() { return { costUsd, dataFound: true }; } };
}

describe("runLoop run-log persistence", () => {
  test("a loop with no watchdog config still persists a run log with per-iteration data", async () => {
    await withTempDir(async (dir) => {
      const diffSource: DiffSource = { async diffBetween() { return "real diff text " + Math.random(); } };
      const result = await runLoop(
        { command: RESPONSIVE_LONG_CHILD, cwd: dir, pollIntervalMs: 20, gracefulTimeoutMs: 5000, maxIters: 2 },
        flatCost(0.5),
        incrementingCommitSource(),
        diffSource
      );
      expect(result.runLogPath).not.toBeNull();
      const runLog = await loadRunLog(result.runLogPath!);
      expect(runLog.iterations.length).toBe(2);
      expect(runLog.stopReason).toBe("max-iters");
      expect(runLog.iterations[0]!.costUsd).toBe(0.5);
      expect(runLog.watchdogSavings).toBeNull(); // no watchdog trip, so no savings estimate
    });
  });

  test("a watchdog trip with --max-iters headroom produces a non-null savings estimate in the run log", async () => {
    await withTempDir(async (dir) => {
      const config: WatchdogConfig = { noProgressPolls: 3, identicalDiffIters: 3, repeatedErrorIters: 3 };
      const diffSource: DiffSource = { async diffBetween() { return "same diff every time"; } };
      const result = await runLoop(
        {
          command: RESPONSIVE_LONG_CHILD,
          cwd: dir,
          pollIntervalMs: 20,
          gracefulTimeoutMs: 5000,
          maxIters: 50,
          watchdog: config,
        },
        flatCost(0.25),
        incrementingCommitSource(),
        diffSource
      );
      expect(result.stopReason).toBe("watchdog:identical-diffs");
      const runLog = await loadRunLog(result.runLogPath!);
      expect(runLog.watchdogSavings).not.toBeNull();
      expect(runLog.watchdogSavings!.lowUsd).toBeLessThan(runLog.watchdogSavings!.highUsd);
      // every iteration here has an identical, non-empty diff after the first — waste-flagged
      expect(runLog.iterations.some((it) => it.wasteReason === "identical-diff")).toBe(true);
    });
  });
});
