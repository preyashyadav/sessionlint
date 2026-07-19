/**
 * Persists which warning-ladder thresholds have already fired for which
 * session, so each rung (50/80/95%) fires exactly once per session, not on
 * every subsequent statusline invocation.
 */

import { homedir } from "os";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";

export interface SentinelState {
  [sessionId: string]: number[];
}

const MAX_TRACKED_SESSIONS = 50;

export function defaultSentinelStatePath(): string {
  return join(homedir(), ".sessionlint", "sentinel-state.json");
}

export async function loadSentinelState(path: string): Promise<SentinelState> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as SentinelState;
  } catch {
    return {};
  }
}

export async function saveSentinelState(path: string, state: SentinelState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const entries = Object.entries(state);
  const bounded = entries.length > MAX_TRACKED_SESSIONS ? entries.slice(entries.length - MAX_TRACKED_SESSIONS) : entries;
  await writeFile(path, JSON.stringify(Object.fromEntries(bounded)), "utf8");
}

export function markThresholdsFired(state: SentinelState, sessionId: string, thresholds: number[]): SentinelState {
  const existing = state[sessionId] ?? [];
  const merged = [...new Set([...existing, ...thresholds])].sort((a, b) => a - b);
  return { ...state, [sessionId]: merged };
}
