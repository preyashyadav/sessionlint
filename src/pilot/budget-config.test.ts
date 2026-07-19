import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { clearBudgetConfig, readBudgetConfig, writeBudgetConfig } from "./budget-config";

async function withTempPath(fn: (path: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "sessionlint-budget-"));
  try {
    await fn(join(dir, "budget.json"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("budget-config", () => {
  test("missing file returns null, not an error", async () => {
    await withTempPath(async (path) => {
      expect(await readBudgetConfig(path)).toBeNull();
    });
  });

  test("round-trips through disk", async () => {
    await withTempPath(async (path) => {
      await writeBudgetConfig(path, { budgetUsd: 25 });
      expect(await readBudgetConfig(path)).toEqual({ budgetUsd: 25 });
    });
  });

  test("clearing a set budget removes it", async () => {
    await withTempPath(async (path) => {
      await writeBudgetConfig(path, { budgetUsd: 25 });
      await clearBudgetConfig(path);
      expect(await readBudgetConfig(path)).toBeNull();
    });
  });

  test("clearing an unset budget is a no-op, not an error", async () => {
    await withTempPath(async (path) => {
      await clearBudgetConfig(path);
      expect(await readBudgetConfig(path)).toBeNull();
    });
  });

  test("a non-positive or malformed budget is rejected as invalid, not trusted", async () => {
    await withTempPath(async (path) => {
      await writeFile(path, JSON.stringify({ budgetUsd: -5 }));
      expect(await readBudgetConfig(path)).toBeNull();
      await writeFile(path, JSON.stringify({ budgetUsd: "lots" }));
      expect(await readBudgetConfig(path)).toBeNull();
    });
  });

  test("corrupt file degrades to null, not a crash", async () => {
    await withTempPath(async (path) => {
      await writeFile(path, "{not valid json");
      expect(await readBudgetConfig(path)).toBeNull();
    });
  });
});
