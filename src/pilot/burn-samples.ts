/**
 * Sliding-window persistence for burn-rate samples (Phase 3 Task 1). Each
 * `sessionlint statusline` invocation is a fresh process, so the sample
 * history has to live on disk between invocations. Samples are keyed by the
 * rate-limit window's `resetsAt` — when that changes, a new 5-hour window has
 * started server-side and old samples no longer describe the current window.
 */

import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname } from "path";
import type { BurnSample } from "./types";

export const SLIDING_WINDOW_MS = 30 * 60 * 1000;

export interface SampleStoreState {
  windowKey: number;
  samples: BurnSample[];
}

export async function loadSampleStore(path: string): Promise<SampleStoreState | null> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<SampleStoreState>;
    if (typeof parsed.windowKey !== "number" || !Array.isArray(parsed.samples)) return null;
    return { windowKey: parsed.windowKey, samples: parsed.samples };
  } catch {
    return null;
  }
}

export async function saveSampleStore(path: string, state: SampleStoreState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state), "utf8");
}

/** Pure: appends `sample`, discarding stale-window or out-of-window history. */
export function recordSample(
  existing: SampleStoreState | null,
  windowKey: number,
  sample: BurnSample
): SampleStoreState {
  const priorSamples = existing && existing.windowKey === windowKey ? existing.samples : [];
  const withinWindow = priorSamples.filter((s) => sample.timestamp - s.timestamp <= SLIDING_WINDOW_MS);
  return { windowKey, samples: [...withinWindow, sample] };
}
