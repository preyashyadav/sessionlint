/**
 * Orchestrates one `sessionlint statusline` invocation: parse stdin JSON,
 * persist a burn sample, compute the rate + forecast band, render one line.
 * Degrades gracefully (C-1) when rate_limits is absent — non-subscribers and
 * the first turn of a session never see a crash, just a named missing state.
 */

import { homedir } from "os";
import { join } from "path";
import { estimateBurnRates } from "./burn-rate";
import { loadSampleStore, recordSample, saveSampleStore } from "./burn-samples";
import { forecastWallMinutes } from "./forecast";
import { renderGauge } from "./render";
import { parseStatusLineInput } from "./statusline-input";

export function defaultStateFilePath(): string {
  return join(homedir(), ".sessionlint", "burn-state.json");
}

export interface RunStatuslineOptions {
  stateFilePath?: string;
  nowMs?: () => number;
}

export async function runStatusline(rawInput: unknown, options: RunStatuslineOptions = {}): Promise<string> {
  const nowMs = options.nowMs ?? (() => Date.now());
  const input = parseStatusLineInput(rawInput);
  const window = input.rateLimits?.fiveHour;
  if (!window) {
    return "sessionlint: quota data unavailable this turn";
  }

  const statePath = options.stateFilePath ?? defaultStateFilePath();
  const existing = await loadSampleStore(statePath);
  const timestamp = nowMs();
  const updated = recordSample(existing, window.resetsAt, { timestamp, usedPercentage: window.usedPercentage });
  await saveSampleStore(statePath, updated);

  const estimates = estimateBurnRates(updated.samples);
  if (!estimates) {
    return `sessionlint: ${Math.round(window.usedPercentage)}% used, 5h window · collecting burn-rate data`;
  }

  const minutesToReset = (window.resetsAt - timestamp / 1000) / 60;
  const remainingPercentage = 100 - window.usedPercentage;
  const band = forecastWallMinutes(remainingPercentage, minutesToReset, estimates);
  return renderGauge(window.usedPercentage, band);
}
