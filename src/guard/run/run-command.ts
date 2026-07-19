/**
 * Orchestrates `sessionlint run`: cost-preview + mandatory confirm gate
 * (same pattern as Phase 2's --verify — real, billed API calls require
 * explicit confirmation, never silent), then the model ladder, then a
 * savings-ledger entry.
 */

import { appendLedgerEntry, defaultLedgerPath } from "./savings-ledger";
import { runModelLadder } from "./model-ladder";
import type { ClaudeRunner, RunProfile, RunResult, SuccessChecker } from "./types";

export interface RunCommandOptions {
  prompt: string;
  cwd: string;
  profile: RunProfile;
  runner: ClaudeRunner;
  checker: SuccessChecker;
  ledgerPath?: string;
  confirm: (previewMessage: string) => Promise<boolean>;
  now?: () => Date;
}

export type RunCommandOutcome = { outcome: "declined" } | { outcome: "completed"; result: RunResult };

export function buildCostPreview(profile: RunProfile): string {
  const budgetNote =
    profile.budgetUsd !== undefined ? `capped at $${profile.budgetUsd.toFixed(2)} per rung` : "no per-rung budget cap set";
  return (
    `This will make up to ${profile.modelLadder.length} real, billed claude -p call(s) ` +
    `(${profile.modelLadder.join(" → ")}), ${budgetNote}. Each rung runs your success-check ` +
    `command (${profile.successCheck.join(" ")}) and stops at the first one that passes.`
  );
}

export async function runCommand(options: RunCommandOptions): Promise<RunCommandOutcome> {
  const confirmed = await options.confirm(buildCostPreview(options.profile));
  if (!confirmed) return { outcome: "declined" };

  const result = await runModelLadder(options.prompt, options.cwd, options.profile, options.runner, options.checker);
  await appendLedgerEntry(options.ledgerPath ?? defaultLedgerPath(), {
    timestamp: (options.now ?? (() => new Date()))().toISOString(),
    result,
  });
  return { outcome: "completed", result };
}
