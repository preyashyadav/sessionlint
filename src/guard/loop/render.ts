import type { LoopResult } from "./types";

export function renderLoopResult(result: LoopResult): string {
  const lines: string[] = [`sessionlint loop: ${result.iterationsCompleted} iteration(s) completed (git-commit boundaries)`];
  if (result.stopReason) {
    lines.push(`Stopped by sessionlint: ${result.stopReason}`);
  } else {
    lines.push(`Child exited on its own (exit code ${result.exitCode ?? "unknown"})`);
  }
  if (result.handoffNoteWritten) lines.push("Handoff note appended to the project's plan file.");
  if (result.stopReason?.startsWith("watchdog:")) {
    lines.push(result.notified ? "Desktop notification sent." : "Desktop notification not sent (unsupported platform or suppressed).");
  }
  if (result.runLogPath) {
    lines.push(`Run log written: ${result.runLogPath} (view with \`sessionlint report --last\`)`);
  }
  return lines.join("\n");
}
