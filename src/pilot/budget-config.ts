/**
 * Phase 3 Task 5: local budget config for the credits sentinel. Scope is
 * deliberately per-SESSION, not a cross-session monthly budget — it tracks
 * against statusLine's own `cost.total_cost_usd`, which is scoped to the
 * current session (docs/usage-surfaces.md). A cross-session/billing-cycle
 * budget would need aggregating cost across multiple discovered session
 * files, which is a bigger, separate feature; this is a first cut, meant to
 * be revisited if Task 6's dogfood shows per-session isn't the right
 * granularity.
 */

import { homedir } from "os";
import { mkdir, readFile, writeFile, unlink } from "fs/promises";
import { dirname, join } from "path";

export interface BudgetConfig {
  budgetUsd: number;
}

export function defaultBudgetConfigPath(): string {
  return join(homedir(), ".sessionlint", "budget.json");
}

export async function readBudgetConfig(path: string): Promise<BudgetConfig | null> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<BudgetConfig>;
    if (typeof parsed.budgetUsd !== "number" || parsed.budgetUsd <= 0) return null;
    return { budgetUsd: parsed.budgetUsd };
  } catch {
    return null;
  }
}

export async function writeBudgetConfig(path: string, config: BudgetConfig): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(config, null, 2) + "\n", "utf8");
}

export async function clearBudgetConfig(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // already absent — clearing a not-set budget is a no-op, not an error
  }
}
