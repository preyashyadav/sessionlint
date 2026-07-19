import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { writeBudgetConfig } from "./budget-config";
import { runCreditsSentinelCheck } from "./credits-check";
import { loadSentinelState } from "./sentinel-state";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "sessionlint-creditscheck-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function fakeNotify(calls: Array<{ title: string; message: string }>) {
  return async (title: string, message: string) => {
    calls.push({ title, message });
    return true;
  };
}

describe("runCreditsSentinelCheck", () => {
  test("no budget configured — no-op, no notification, D-003 off by default", async () => {
    await withTempDir(async (dir) => {
      const calls: Array<{ title: string; message: string }> = [];
      const messages = await runCreditsSentinelCheck(
        { session_id: "s1", cost: { total_cost_usd: 100 } },
        { budgetConfigPath: join(dir, "budget.json"), sentinelStatePath: join(dir, "state.json"), notify: fakeNotify(calls) }
      );
      expect(messages).toEqual([]);
      expect(calls).toEqual([]);
    });
  });

  test("budget configured but no cost/session_id in input — no-op, not a crash", async () => {
    await withTempDir(async (dir) => {
      const budgetConfigPath = join(dir, "budget.json");
      await writeBudgetConfig(budgetConfigPath, { budgetUsd: 10 });
      const messages = await runCreditsSentinelCheck(
        {},
        { budgetConfigPath, sentinelStatePath: join(dir, "state.json") }
      );
      expect(messages).toEqual([]);
    });
  });

  test("crossing a threshold fires exactly one advisory and one notification", async () => {
    await withTempDir(async (dir) => {
      const budgetConfigPath = join(dir, "budget.json");
      const sentinelStatePath = join(dir, "state.json");
      await writeBudgetConfig(budgetConfigPath, { budgetUsd: 10 });
      const calls: Array<{ title: string; message: string }> = [];
      const messages = await runCreditsSentinelCheck(
        { session_id: "s1", cost: { total_cost_usd: 6 } }, // 60% of budget
        { budgetConfigPath, sentinelStatePath, notify: fakeNotify(calls) }
      );
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain("50%");
      expect(calls).toHaveLength(1);

      const state = await loadSentinelState(sentinelStatePath);
      expect(state["s1"]).toEqual([50]);
    });
  });

  test("the same threshold does not fire again on a subsequent check with unchanged spend", async () => {
    await withTempDir(async (dir) => {
      const budgetConfigPath = join(dir, "budget.json");
      const sentinelStatePath = join(dir, "state.json");
      await writeBudgetConfig(budgetConfigPath, { budgetUsd: 10 });
      const input = { session_id: "s1", cost: { total_cost_usd: 6 } };
      const notify = fakeNotify([]);
      await runCreditsSentinelCheck(input, { budgetConfigPath, sentinelStatePath, notify });
      const secondRun = await runCreditsSentinelCheck(input, { budgetConfigPath, sentinelStatePath, notify });
      expect(secondRun).toEqual([]);
    });
  });

  test("spend climbing further fires only the newly-crossed rung(s)", async () => {
    await withTempDir(async (dir) => {
      const budgetConfigPath = join(dir, "budget.json");
      const sentinelStatePath = join(dir, "state.json");
      await writeBudgetConfig(budgetConfigPath, { budgetUsd: 10 });
      const notify = fakeNotify([]);
      await runCreditsSentinelCheck({ session_id: "s1", cost: { total_cost_usd: 6 } }, { budgetConfigPath, sentinelStatePath, notify });
      const messages = await runCreditsSentinelCheck(
        { session_id: "s1", cost: { total_cost_usd: 9.6 } }, // 96% — crosses 80 and 95
        { budgetConfigPath, sentinelStatePath, notify }
      );
      expect(messages).toHaveLength(2);
      expect(messages[0]).toContain("80%");
      expect(messages[1]).toContain("95%");
    });
  });

  test("different sessions get independent warning ladders", async () => {
    await withTempDir(async (dir) => {
      const budgetConfigPath = join(dir, "budget.json");
      const sentinelStatePath = join(dir, "state.json");
      await writeBudgetConfig(budgetConfigPath, { budgetUsd: 10 });
      const notify = fakeNotify([]);
      await runCreditsSentinelCheck({ session_id: "s1", cost: { total_cost_usd: 6 } }, { budgetConfigPath, sentinelStatePath, notify });
      const messages = await runCreditsSentinelCheck(
        { session_id: "s2", cost: { total_cost_usd: 6 } },
        { budgetConfigPath, sentinelStatePath, notify }
      );
      expect(messages).toHaveLength(1); // s2's own first crossing, independent of s1
    });
  });
});
