import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { runLoop } from "./loop-runner";
import type { CommitSource, CostSource } from "./types";
import type { DiffSource, WatchdogConfig } from "../watchdog/types";
import type { TestCommandRunner } from "../watchdog/test-command-runner";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "sessionlint-loop-wd-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const noCost: CostSource = { async costSince() { return { costUsd: 0, dataFound: false }; } };
const RESPONSIVE_LONG_CHILD = ["bash", "-c", "trap 'exit 0' TERM; sleep 30 & wait \"$!\""];

function incrementingCommitSource(): CommitSource {
  let n = 0;
  return { async getHeadCommit() { n++; return `commit-${n}`; } };
}

function stableCommitSource(commit: string): CommitSource {
  return { async getHeadCommit() { return commit; } };
}

/** Yields `maxCommits` distinct commits, then stays on the last one forever — simulates a
 * loop that did a bounded number of iterations and then stalled, for deterministic tests. */
function boundedIncrementingCommitSource(maxCommits: number): CommitSource {
  let n = 0;
  return {
    async getHeadCommit() {
      n = Math.min(n + 1, maxCommits);
      return `commit-${n}`;
    },
  };
}

const config: WatchdogConfig = { noProgressPolls: 3, identicalDiffIters: 3, repeatedErrorIters: 3 };

describe("runLoop watchdog integration", () => {
  test("no-new-commits trips after enough polls with a stable commit", async () => {
    await withTempDir(async (dir) => {
      const result = await runLoop(
        { command: RESPONSIVE_LONG_CHILD, cwd: dir, pollIntervalMs: 20, gracefulTimeoutMs: 5000, watchdog: config },
        noCost,
        stableCommitSource("commit-1")
      );
      expect(result.stopReason).toBe("watchdog:no-new-commits");
    });
  });

  test("identical diffs across commits trips the watchdog", async () => {
    await withTempDir(async (dir) => {
      const diffSource: DiffSource = { async diffBetween() { return "same diff every time"; } };
      const result = await runLoop(
        { command: RESPONSIVE_LONG_CHILD, cwd: dir, pollIntervalMs: 20, gracefulTimeoutMs: 5000, watchdog: config },
        noCost,
        incrementingCommitSource(),
        diffSource
      );
      expect(result.stopReason).toBe("watchdog:identical-diffs");
    });
  });

  test("oscillating diffs (A -> B -> A) trip the watchdog", async () => {
    await withTempDir(async (dir) => {
      const diffs = ["A", "B", "A"];
      let i = 0;
      const diffSource: DiffSource = { async diffBetween() { return diffs[Math.min(i++, diffs.length - 1)]!; } };
      const result = await runLoop(
        { command: RESPONSIVE_LONG_CHILD, cwd: dir, pollIntervalMs: 20, gracefulTimeoutMs: 5000, watchdog: config },
        noCost,
        incrementingCommitSource(),
        diffSource
      );
      expect(result.stopReason).toBe("watchdog:oscillation");
    });
  });

  test("a repeated identical test failure trips the watchdog", async () => {
    await withTempDir(async (dir) => {
      const diffSource: DiffSource = { async diffBetween() { return "irrelevant, changes each time " + Math.random(); } };
      const testCommandRunner: TestCommandRunner = {
        async run() { return { exitCode: 1, output: "AssertionError: expected 1 to be 2\nat foo.ts:1" }; },
      };
      const result = await runLoop(
        {
          command: RESPONSIVE_LONG_CHILD,
          cwd: dir,
          pollIntervalMs: 20,
          gracefulTimeoutMs: 5000,
          watchdog: config,
          testCommand: ["npm", "test"],
        },
        noCost,
        incrementingCommitSource(),
        diffSource,
        testCommandRunner
      );
      expect(result.stopReason).toBe("watchdog:repeated-error");
    });
  });

  test("a passing test command in between failures resets the repeated-error streak", async () => {
    await withTempDir(async (dir) => {
      // 4 bounded iterations: fail, pass, fail, fail — only 2 consecutive fails after the
      // pass, one short of the 3-in-a-row threshold, so repeated-error must never trip. The
      // commit source then stalls (stays on commit-4), so the loop eventually stops via
      // no-new-commits instead — a clean, deterministic outcome to assert against.
      const diffSource: DiffSource = { async diffBetween() { return "changes " + Math.random(); } };
      let calls = 0;
      const testCommandRunner: TestCommandRunner = {
        async run() {
          calls++;
          return calls === 2 ? { exitCode: 0, output: "PASS" } : { exitCode: 1, output: "same error every time" };
        },
      };
      const result = await runLoop(
        { command: RESPONSIVE_LONG_CHILD, cwd: dir, pollIntervalMs: 20, gracefulTimeoutMs: 5000, watchdog: config, testCommand: ["npm", "test"] },
        noCost,
        boundedIncrementingCommitSource(4),
        diffSource,
        testCommandRunner
      );
      expect(result.stopReason).toBe("watchdog:no-new-commits"); // not repeated-error
    });
  });

  test("no watchdog config means no watchdog checks at all, regardless of signals present", async () => {
    await withTempDir(async (dir) => {
      const diffSource: DiffSource = { async diffBetween() { return "same diff every time"; } };
      const result = await runLoop(
        { command: ["bash", "-c", "sleep 0.3; exit 0"], cwd: dir, pollIntervalMs: 20 },
        noCost,
        incrementingCommitSource(),
        diffSource
      );
      expect(result.stopReason).toBeNull();
    });
  });
});
