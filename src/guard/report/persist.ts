/**
 * Run logs are written project-locally (<projectDir>/.sessionlint/loop-runs/), not under
 * ~/.sessionlint like Phase 3's burn-state/sentinel-state — those are cross-project
 * session-level state, but a loop run belongs to one specific project, same reasoning as
 * handoff-note.ts appending to the project's OWN plan file rather than a home-dir location.
 * This also means existing loop-runner tests that already point `cwd` at a temp dir get this
 * sandboxed for free, no separate test-only override needed.
 */

import { mkdir, readdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import type { RunLog } from "./types";

function runLogsDir(projectDir: string): string {
  return join(projectDir, ".sessionlint", "loop-runs");
}

function fileNameFor(runLog: RunLog): string {
  return `${runLog.runEndedAt.replace(/[:.]/g, "-")}.json`;
}

export async function writeRunLog(runLog: RunLog): Promise<string> {
  const dir = runLogsDir(runLog.projectDir);
  await mkdir(dir, { recursive: true });
  const path = join(dir, fileNameFor(runLog));
  await writeFile(path, JSON.stringify(runLog, null, 2), "utf8");
  return path;
}

export async function loadRunLog(path: string): Promise<RunLog> {
  return JSON.parse(await readFile(path, "utf8")) as RunLog;
}

/** Returns null when no run log exists yet for this project — a named missing capability, not
 * an error (C-1 style graceful degradation). */
export async function loadLastRunLog(projectDir: string): Promise<{ path: string; runLog: RunLog } | null> {
  const dir = runLogsDir(projectDir);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return null;
  }
  const jsonFiles = files.filter((f) => f.endsWith(".json")).sort();
  const last = jsonFiles[jsonFiles.length - 1];
  if (!last) return null;
  const path = join(dir, last);
  return { path, runLog: await loadRunLog(path) };
}
