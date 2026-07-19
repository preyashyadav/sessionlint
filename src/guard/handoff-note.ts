/**
 * Phase 4 Task 1: appends a handoff note to the project's plan file when a
 * supervised run stops. Spec says "if one exists" — deliberately does NOT
 * create a new file when no plan file is found; inventing a new file
 * location the human never opted into isn't this feature's place (D-003).
 */

import { appendFile } from "fs/promises";
import { findPlanFilePath } from "../pilot/plan-file";

export interface HandoffNote {
  timestamp: string; // ISO
  reason: string;
  stoppedGracefully: boolean;
  exitCode: number | null;
  lastOutputLines: string[];
}

export function renderHandoffNote(note: HandoffNote): string {
  const lines = [
    "",
    `## sessionlint handoff — ${note.timestamp}`,
    `Stopped: ${note.reason} (${note.stoppedGracefully ? "graceful" : "forced"} stop, exit code ${note.exitCode ?? "unknown"})`,
  ];
  if (note.lastOutputLines.length > 0) {
    lines.push("Last output before stopping:");
    for (const line of note.lastOutputLines) lines.push(`> ${line}`);
  }
  lines.push("");
  return lines.join("\n");
}

/** Returns true if a note was actually written (a plan file existed), false if there was
 * nothing to append to — both are valid outcomes, never an error. */
export async function appendHandoffNote(cwd: string, note: HandoffNote): Promise<boolean> {
  const path = await findPlanFilePath(cwd);
  if (!path) return false;
  await appendFile(path, renderHandoffNote(note), "utf8");
  return true;
}
