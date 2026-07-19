/**
 * Orchestrates one `UserPromptSubmit` hook invocation: read the hook's stdin
 * JSON, check the latest burn sample (written by `sessionlint statusline`)
 * against the wind-down threshold, and return plain text for stdout —
 * per research, plain-text stdout on exit 0 is the only advisory-injection
 * path that's reliable in both the CLI and VSCode (the JSON
 * `additionalContext` path has a documented VSCode delivery bug).
 *
 * Returns "" (no output) when nothing should fire — the hook always exits 0
 * either way; a wind-down advisory must never block prompt submission.
 */

import { loadSampleStore } from "./burn-samples";
import { defaultStateFilePath } from "./statusline";
import { parseHookInput } from "./hook-input";
import { readPlanItems } from "./plan-file";
import { buildAdvisory, renderAdvisory } from "./wind-down";

export interface RunHookOptions {
  stateFilePath?: string;
}

export async function runUserPromptSubmitHook(rawInput: unknown, options: RunHookOptions = {}): Promise<string> {
  const input = parseHookInput(rawInput);
  const statePath = options.stateFilePath ?? defaultStateFilePath();
  const store = await loadSampleStore(statePath);
  const samples = store?.samples ?? [];
  if (samples.length === 0) return "";

  const latest = samples[samples.length - 1]!;
  const planItems = input.cwd ? await readPlanItems(input.cwd) : null;
  const advisory = buildAdvisory(latest.usedPercentage, planItems);
  return advisory.fired ? renderAdvisory(advisory) : "";
}
