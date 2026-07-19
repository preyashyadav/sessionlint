/**
 * Phase 3 Task 4: delegation autopilot config writer. Real architectural
 * constraint discovered before writing this (see MASTER.md §7): sessionlint
 * runs as a separate process and cannot mutate an already-running Claude
 * Code session's environment — a hook subprocess cannot reach back into its
 * parent. So this writes CLAUDE_CODE_SUBAGENT_MODEL into settings.json's
 * `env` block, which takes effect on Claude Code's NEXT session start, not
 * the current one. The CLI is explicit about this — it must never imply a
 * live, same-session effect it can't deliver.
 *
 * Read-modify-write is a full JSON.parse/stringify pass, not a JSONC patch —
 * this only touches the one `env.CLAUDE_CODE_SUBAGENT_MODEL` key but does
 * reformat the whole file and does NOT support comments in the settings
 * file. If the file fails to parse as JSON, this refuses to touch it rather
 * than guessing at a corrupt/JSONC-with-comments format.
 */

import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname } from "path";

const SUBAGENT_MODEL_ENV_KEY = "CLAUDE_CODE_SUBAGENT_MODEL";

export class SettingsParseError extends Error {}

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

/** Enables delegation autopilot: sets the subagent model override, preserving all other keys. */
export async function enableAutoDelegate(settingsPath: string, model: string): Promise<void> {
  const settings = await readSettings(settingsPath);
  const env = (settings["env"] as Record<string, unknown> | undefined) ?? {};
  settings["env"] = { ...env, [SUBAGENT_MODEL_ENV_KEY]: model };
  await writeSettings(settingsPath, settings);
}

/** Disables delegation autopilot: removes only the one key it added, preserving everything else. */
export async function disableAutoDelegate(settingsPath: string): Promise<void> {
  const settings = await readSettings(settingsPath);
  const env = settings["env"] as Record<string, unknown> | undefined;
  if (!env || !(SUBAGENT_MODEL_ENV_KEY in env)) return;

  const { [SUBAGENT_MODEL_ENV_KEY]: _removed, ...remainingEnv } = env;
  if (Object.keys(remainingEnv).length > 0) {
    settings["env"] = remainingEnv;
  } else {
    delete settings["env"];
  }
  await writeSettings(settingsPath, settings);
}

/** Reads back the currently configured override, or null if not set. */
export async function readAutoDelegateModel(settingsPath: string): Promise<string | null> {
  const settings = await readSettings(settingsPath);
  const env = settings["env"] as Record<string, unknown> | undefined;
  const value = env?.[SUBAGENT_MODEL_ENV_KEY];
  return typeof value === "string" ? value : null;
}
