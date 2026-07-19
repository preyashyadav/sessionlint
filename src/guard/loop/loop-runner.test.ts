import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { runLoop } from "./loop-runner";
import type { CommitSource, CostSource } from "./types";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "sessionlint-loop-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const noCost: CostSource = { async costSince() { return { costUsd: 0, dataFound: false }; } };
const noCommits: CommitSource = { async getHeadCommit() { return null; } };

// A responsive long-lived child using the `& wait` idiom (see process-supervisor.test.ts —
// a plain foreground `sleep` can't be interrupted by a trap promptly; this can).
const RESPONSIVE_LONG_CHILD = ["bash", "-c", "trap 'exit 0' TERM; sleep 30 & wait \"$!\""];

function costSourceCrossingAfter(pollsBeforeThreshold: number, thresholdCostUsd: number): CostSource {
  let calls = 0;
  return {
    async costSince() {
      calls++;
      return { costUsd: calls > pollsBeforeThreshold ? thresholdCostUsd : 0, dataFound: true };
    },
  };
}

function incrementingCommitSource(): CommitSource {
  let n = 0;
  return {
    async getHeadCommit() {
      n++;
      return `commit-${n}`;
    },
  };
}

describe("runLoop", () => {
  test("a child that exits naturally with no thresholds set reports no stop reason", async () => {
    await withTempDir(async (dir) => {
      const result = await runLoop(
        { command: ["bash", "-c", "exit 0"], cwd: dir, pollIntervalMs: 20 },
        noCost,
        noCommits
      );
      expect(result.stopReason).toBeNull();
      expect(result.exitCode).toBe(0);
      expect(result.handoffNoteWritten).toBe(false);
    });
  });

  test("overall budget exceeded stops the child and reports the reason", async () => {
    await withTempDir(async (dir) => {
      const costSource = costSourceCrossingAfter(1, 5);
      const result = await runLoop(
        { command: RESPONSIVE_LONG_CHILD, cwd: dir, budgetUsd: 5, pollIntervalMs: 20, gracefulTimeoutMs: 5000 },
        costSource,
        noCommits
      );
      expect(result.stopReason).toBe("overall-budget");
      expect(result.signalCode).not.toBe("SIGKILL"); // the trap caught it gracefully
    });
  });

  test("max-iters reached (each poll sees a new commit) stops the child", async () => {
    await withTempDir(async (dir) => {
      const result = await runLoop(
        { command: RESPONSIVE_LONG_CHILD, cwd: dir, maxIters: 3, pollIntervalMs: 20, gracefulTimeoutMs: 5000 },
        noCost,
        incrementingCommitSource()
      );
      expect(result.stopReason).toBe("max-iters");
      expect(result.iterationsCompleted).toBe(3);
    });
  });

  test("per-iter budget exceeded within a stable iteration stops the child", async () => {
    await withTempDir(async (dir) => {
      // one commit lands immediately (iteration 1 starts), then cost within that iteration
      // crosses the per-iter threshold before any further commit appears
      let commitCalls = 0;
      const commitSource: CommitSource = {
        async getHeadCommit() {
          commitCalls++;
          return commitCalls === 1 ? "commit-1" : "commit-1"; // stable after the first call
        },
      };
      const costSource = costSourceCrossingAfter(1, 2);
      const result = await runLoop(
        { command: RESPONSIVE_LONG_CHILD, cwd: dir, perIterBudgetUsd: 2, pollIntervalMs: 20, gracefulTimeoutMs: 5000 },
        costSource,
        commitSource
      );
      expect(result.stopReason).toBe("per-iter-budget");
    });
  });

  test("a threshold-triggered stop writes a handoff note when a plan file exists", async () => {
    await withTempDir(async (dir) => {
      const { writeFile } = await import("fs/promises");
      await writeFile(join(dir, "TODO.md"), "- [ ] Something\n");
      const result = await runLoop(
        { command: RESPONSIVE_LONG_CHILD, cwd: dir, budgetUsd: 1, pollIntervalMs: 20, gracefulTimeoutMs: 5000 },
        costSourceCrossingAfter(0, 1),
        noCommits
      );
      expect(result.stopReason).toBe("overall-budget");
      expect(result.handoffNoteWritten).toBe(true);
    });
  });

  test("cost source reporting dataFound:false never triggers a stop, even at a high number", async () => {
    await withTempDir(async (dir) => {
      const unreliableCostSource: CostSource = { async costSince() { return { costUsd: 999, dataFound: false }; } };
      const result = await runLoop(
        { command: ["bash", "-c", "sleep 0.3; exit 0"], cwd: dir, budgetUsd: 1, pollIntervalMs: 20 },
        unreliableCostSource,
        noCommits
      );
      expect(result.stopReason).toBeNull(); // exited naturally, not stopped by the (untrustworthy) cost figure
    });
  });
});
