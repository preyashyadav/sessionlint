/**
 * Phase 4 Task 3: tracks $ spend for a project since a given timestamp, by
 * polling the SAME local ~/.claude/projects JSONL that LENS already reads —
 * not by requiring any cooperation from an opaque wrapped child process.
 * This is what makes `--budget` possible for `sessionlint loop -- <cmd>`
 * even though the wrapped command could be a plain bash script sessionlint
 * has no other visibility into.
 *
 * `encodeProjectPath` mirrors what's directly observed in this machine's
 * real ~/.claude/projects directory (project dirs are the absolute path
 * with "/" replaced by "-") — verified against 3 real project directories,
 * but NOT against this exact project's own directory (no matching entry
 * exists here to compare), so treat this as a strong ASSUMPTION, not a
 * fully closed fact — see MASTER.md §9/§7. A path containing "." or other
 * special characters may encode differently; not tested here.
 */

import { readdir } from "fs/promises";
import { join } from "path";
import { defaultRoot } from "../../adapters/claude-code/discover";
import { loadSession } from "../../adapters/claude-code/session";
import { computeTurnCost } from "../../cost/compute";

export function encodeProjectPath(absolutePath: string): string {
  return absolutePath.replace(/\//g, "-");
}

export interface ProjectCostSinceResult {
  costUsd: number;
  /** false when no local session directory was found for this project at all — a named
   * missing capability (C-1 style), never silently reported as $0 when the real answer
   * is "unknown," e.g. because the encoding assumption above didn't match. */
  dataFound: boolean;
}

export async function costSince(projectDir: string, sinceMs: number, claudeProjectsRoot?: string): Promise<ProjectCostSinceResult> {
  // defaultRoot honors CLAUDE_CONFIG_DIR (see discover.ts) — budget tracking must look
  // wherever this environment's Claude Code actually writes transcripts.
  const root = claudeProjectsRoot ?? defaultRoot();
  const encodedDir = join(root, encodeProjectPath(projectDir));

  let entries: string[];
  try {
    entries = await readdir(encodedDir);
  } catch {
    return { costUsd: 0, dataFound: false };
  }

  let totalCostUsd = 0;
  let dataFound = false;
  for (const entry of entries) {
    if (!entry.endsWith(".jsonl")) continue;
    let session;
    try {
      ({ session } = await loadSession(join(encodedDir, entry)));
    } catch {
      continue;
    }
    dataFound = true;
    for (const turn of session.turns) {
      if (!turn.startedAt || turn.startedAt.getTime() < sinceMs) continue;
      totalCostUsd += computeTurnCost(turn).totalCost;
    }
  }
  return { costUsd: totalCostUsd, dataFound };
}
