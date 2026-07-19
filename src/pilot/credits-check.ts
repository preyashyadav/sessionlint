/**
 * Orchestrates one credits-sentinel check: parse statusLine JSON for
 * session_id + cost.total_cost_usd, compare against the locally configured
 * per-session budget, fire any newly-crossed warning-ladder rungs exactly
 * once each, and best-effort dispatch a desktop notification per rung.
 * Degrades to "nothing fired" whenever budget/session/cost data is missing —
 * never a crash, and never fires for users who haven't opted in by setting
 * a budget (D-003: off by default).
 */

import { readBudgetConfig, defaultBudgetConfigPath } from "./budget-config";
import { buildCreditsSentinelAdvisory, computeNewlyCrossedThresholds } from "./credits-sentinel";
import { sendDesktopNotification } from "./desktop-notify";
import { loadSentinelState, markThresholdsFired, saveSentinelState } from "./sentinel-state";
import { parseStatusLineInput } from "./statusline-input";

export interface CreditsCheckOptions {
  budgetConfigPath?: string;
  sentinelStatePath: string;
  notify?: (title: string, message: string) => Promise<boolean>;
}

export async function runCreditsSentinelCheck(rawInput: unknown, options: CreditsCheckOptions): Promise<string[]> {
  const budgetConfigPath = options.budgetConfigPath ?? defaultBudgetConfigPath();
  const notify = options.notify ?? sendDesktopNotification;

  const budget = await readBudgetConfig(budgetConfigPath);
  if (!budget) return [];

  const input = parseStatusLineInput(rawInput);
  if (!input.sessionId || input.totalCostUsd === undefined) return [];

  const percentUsed = (input.totalCostUsd / budget.budgetUsd) * 100;
  const state = await loadSentinelState(options.sentinelStatePath);
  const alreadyFired = state[input.sessionId] ?? [];
  const newlyCrossed = computeNewlyCrossedThresholds(percentUsed, alreadyFired);
  if (newlyCrossed.length === 0) return [];

  const messages: string[] = [];
  for (const threshold of newlyCrossed) {
    const message = buildCreditsSentinelAdvisory(input.totalCostUsd, budget.budgetUsd, threshold);
    messages.push(message);
    await notify("sessionlint", message);
  }

  await saveSentinelState(options.sentinelStatePath, markThresholdsFired(state, input.sessionId, newlyCrossed));
  return messages;
}
