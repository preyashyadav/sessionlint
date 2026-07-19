/**
 * Phase 5 Task 2 Tier 2 (--enforce path for in-session loops): watch itself
 * NEVER kills anything — the only hard-stop for a loop running INSIDE a
 * Claude Code session is Claude Code's own hook system, which the user
 * installs explicitly (`sessionlint install-hook`, D-003 opt-in).
 *
 * Contract verified LIVE against code.claude.com/docs/en/hooks on 2026-07-16
 * (not assumed): a PreToolUse hook command exiting with code 2 blocks the
 * tool call, and its stderr is fed back to Claude as the reason; matcher "*"
 * matches every tool; project hooks live in .claude/settings(.local).json
 * under hooks.PreToolUse[].hooks[]. Note the Stop hook was deliberately NOT
 * used: exit 2 there PREVENTS Claude from stopping (continues the loop) —
 * the exact opposite of enforcement.
 *
 * Settings writes follow delegate-config.ts's conventions: full-file
 * JSON read-modify-write preserving unknown keys, refusing to touch a file
 * that doesn't parse rather than risk corrupting it.
 */

import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { SettingsParseError } from "../../pilot/delegate-config";
import { WATCH_STATE_FILENAME } from "./watch-runner";

export function defaultHookGateCommand(projectDir: string): string {
  return `sessionlint hook-gate --project-dir ${JSON.stringify(projectDir)}`;
}

/** True for any invocation form of OUR gate command — the default (`sessionlint hook-gate`)
 * and the documented from-source override (`bun run .../index.ts hook-gate ...`). Requiring
 * "hook-gate" plus a sessionlint-ish token keeps a foreign hook that merely mentions
 * "hook-gate" from being uninstalled as ours. (Found live: the original exact-marker check
 * couldn't find its own hook again when installed via --hook-command.) */
export function isHookGateCommand(command: string): boolean {
  return command.includes("hook-gate") && (command.includes("sessionlint") || command.includes("index.ts"));
}

interface HookHandler {
  type?: unknown;
  command?: unknown;
}

interface MatcherGroup {
  matcher?: unknown;
  hooks?: HookHandler[];
}

async function readSettings(settingsPath: string): Promise<Record<string, unknown>> {
  let raw: string;
  try {
    raw = await readFile(settingsPath, "utf8");
  } catch {
    return {};
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    throw new SettingsParseError(
      `${settingsPath} isn't valid JSON — refusing to rewrite it rather than risk corrupting it (${err instanceof Error ? err.message : String(err)})`
    );
  }
}

async function writeSettings(settingsPath: string, settings: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
}

function isOurGroup(group: MatcherGroup): boolean {
  return (group.hooks ?? []).some((h) => typeof h.command === "string" && isHookGateCommand(h.command));
}

/** Idempotently adds the PreToolUse gate hook; returns false if it was already installed. */
export async function installWatchHook(settingsPath: string, command: string): Promise<boolean> {
  const settings = await readSettings(settingsPath);
  const hooks = (settings["hooks"] as Record<string, unknown> | undefined) ?? {};
  const preToolUse = (hooks["PreToolUse"] as MatcherGroup[] | undefined) ?? [];

  if (preToolUse.some(isOurGroup)) return false;

  preToolUse.push({ matcher: "*", hooks: [{ type: "command", command }] });
  settings["hooks"] = { ...hooks, PreToolUse: preToolUse };
  await writeSettings(settingsPath, settings);
  return true;
}

/** Removes only the gate hook group sessionlint installed; returns false if none was found. */
export async function uninstallWatchHook(settingsPath: string): Promise<boolean> {
  const settings = await readSettings(settingsPath);
  const hooks = settings["hooks"] as Record<string, unknown> | undefined;
  const preToolUse = hooks?.["PreToolUse"] as MatcherGroup[] | undefined;
  if (!hooks || !preToolUse) return false;

  const remaining = preToolUse.filter((g) => !isOurGroup(g));
  if (remaining.length === preToolUse.length) return false;

  if (remaining.length > 0) hooks["PreToolUse"] = remaining;
  else delete hooks["PreToolUse"];
  if (Object.keys(hooks).length === 0) delete settings["hooks"];
  await writeSettings(settingsPath, settings);
  return true;
}

export interface TripState {
  reason: string;
  detail: string;
  at: string;
}

/** The trip state runWatch persisted, or null when nothing has tripped (or no watch ran).
 * Unreadable/corrupt state degrades to null — the gate must fail OPEN: a broken state file
 * must never permanently paralyze a session's tool use. */
export async function readTripState(projectDir: string): Promise<TripState | null> {
  try {
    const raw = await readFile(join(projectDir, ".sessionlint", WATCH_STATE_FILENAME), "utf8");
    const parsed = JSON.parse(raw) as { tripped?: unknown; reason?: unknown; detail?: unknown; at?: unknown };
    if (parsed.tripped !== true) return null;
    return {
      reason: typeof parsed.reason === "string" ? parsed.reason : "unknown",
      detail: typeof parsed.detail === "string" ? parsed.detail : "",
      at: typeof parsed.at === "string" ? parsed.at : "",
    };
  } catch {
    return null;
  }
}
