#!/usr/bin/env bun
/**
 * Ledger-reconciliation experiment: statusline stdin capture.
 *
 * Claude Code invokes the statusLine command with the full session JSON on
 * stdin. That payload carries `cost.total_cost_usd` — Claude Code's OWN
 * accounting for the session — which is the only interactive-path ground
 * truth available without spending money. Nothing in sessionlint reads it.
 * This appends every payload it sees to a JSONL log so reconcile.ts can
 * compare it against the ledger built from the transcript.
 *
 * Two hard rules, because this sits in the user's live UI:
 *   1. It must never break the statusline. Every failure path still prints
 *      something and exits 0.
 *   2. It must be fast. No imports beyond node:fs — the statusline re-renders
 *      often, so booting the sessionlint stack here would be felt.
 *
 * Capturing per-render rather than per-turn is deliberate: whether the value
 * is cumulative or a per-turn delta, and how often it moves, are open
 * questions this log is meant to answer. Timestamps + a render counter make
 * the cadence recoverable after the fact.
 */

import { appendFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

const LOG_PATH = join(homedir(), ".sessionlint", "experiment", "statusline-samples.jsonl");

function readStdin(): string {
  try {
    return require("fs").readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function render(p: any): string {
  const cost = p?.cost?.total_cost_usd;
  const cw = p?.context_window;
  const parts: string[] = [];
  if (p?.model?.display_name) parts.push(String(p.model.display_name));
  if (typeof cw?.used_percentage === "number") parts.push(`ctx ${cw.used_percentage}%`);
  if (typeof cost === "number") parts.push(`$${cost.toFixed(2)}`);
  const five = p?.rate_limits?.five_hour?.used_percentage;
  if (typeof five === "number") parts.push(`5h ${five}%`);
  return parts.length ? parts.join("  ·  ") : "sessionlint";
}

const raw = readStdin();
let payload: any = null;
try {
  payload = JSON.parse(raw);
} catch {
  /* keep going — a broken payload must not blank the statusline */
}

/**
 * The ONLY fields this script may ever log, as an explicit allowlist.
 *
 * An allowlist, not a denylist: a denylist ("strip cwd, strip transcript_path")
 * fails open the moment Claude Code adds a field, and the statusline payload
 * carries plenty worth failing closed on — `cwd`, `workspace.repo.owner/name`,
 * `transcript_path`, `session_name`. Each entry maps a stable output key to a
 * reader over the payload. Nothing outside this table is written, and adding a
 * row is a deliberate act.
 *
 * Never add: prompt text, file paths, tool arguments, repo identifiers, session
 * names, or anything free-text.
 */
const FIELD_ALLOWLIST: Record<string, (p: any) => unknown> = {
  sessionId: (p) => p.session_id ?? null,
  version: (p) => p.version ?? null,
  modelId: (p) => p.model?.id ?? null,
  costTotalUsd: (p) => p.cost?.total_cost_usd ?? null,
  costDurationMs: (p) => p.cost?.total_duration_ms ?? null,
  costApiDurationMs: (p) => p.cost?.total_api_duration_ms ?? null,
  linesAdded: (p) => p.cost?.total_lines_added ?? null,
  linesRemoved: (p) => p.cost?.total_lines_removed ?? null,
  ctxTotalInput: (p) => p.context_window?.total_input_tokens ?? null,
  ctxTotalOutput: (p) => p.context_window?.total_output_tokens ?? null,
  ctxWindowSize: (p) => p.context_window?.context_window_size ?? null,
  ctxUsedPct: (p) => p.context_window?.used_percentage ?? null,
  ctxCurrentInput: (p) => p.context_window?.current_usage?.input_tokens ?? null,
  ctxCurrentOutput: (p) => p.context_window?.current_usage?.output_tokens ?? null,
  ctxCurrentCacheRead: (p) => p.context_window?.current_usage?.cache_read_input_tokens ?? null,
  ctxCurrentCacheCreation: (p) => p.context_window?.current_usage?.cache_creation_input_tokens ?? null,
  thinkingEnabled: (p) => p.thinking?.enabled ?? null,
  fastMode: (p) => p.fast_mode ?? null,
  exceeds200k: (p) => p.exceeds_200k_tokens ?? null,
  fiveHourPct: (p) => p.rate_limits?.five_hour?.used_percentage ?? null,
  sevenDayPct: (p) => p.rate_limits?.seven_day?.used_percentage ?? null,
};

if (payload) {
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true });
    const rec: Record<string, unknown> = { capturedAt: new Date().toISOString() };
    for (const [key, read] of Object.entries(FIELD_ALLOWLIST)) {
      // A reader that throws must not take the statusline down, and must not
      // silently promote an unvetted value either.
      try { rec[key] = read(payload); } catch { rec[key] = null; }
    }
    appendFileSync(LOG_PATH, JSON.stringify(rec) + "\n", "utf8");
  } catch {
    /* logging is best-effort; never let it take the statusline down */
  }
}

process.stdout.write(render(payload));
