/**
 * Ties the process supervisor and handoff note together: on a requested
 * stop (not a natural exit — nothing to hand off there), captures the last
 * N output lines and appends a handoff note if a plan file exists.
 */

import { appendHandoffNote } from "./handoff-note";
import { startSupervisedProcess, type ExitInfo } from "./process-supervisor";

export interface SupervisedRunOptions {
  command: string[];
  cwd: string;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
  gracefulTimeoutMs?: number;
  maxLastLines?: number;
  now?: () => Date;
}

export interface SupervisedRunResult extends ExitInfo {
  /** null when the child exited on its own — a requested stop is what triggers a handoff note. */
  stopReason: string | null;
  handoffNoteWritten: boolean;
}

export interface SupervisedRunHandle {
  pid: number;
  requestStop(reason: string): Promise<void>;
  result: Promise<SupervisedRunResult>;
}

export function runSupervised(options: SupervisedRunOptions): SupervisedRunHandle {
  const maxLastLines = options.maxLastLines ?? 20;
  const now = options.now ?? (() => new Date());
  const lastLines: string[] = [];

  const record = (line: string) => {
    lastLines.push(line);
    if (lastLines.length > maxLastLines) lastLines.shift();
  };

  const handle = startSupervisedProcess({
    command: options.command,
    cwd: options.cwd,
    onStdoutLine: (line) => {
      record(line);
      options.onStdoutLine?.(line);
    },
    onStderrLine: (line) => {
      record(line);
      options.onStderrLine?.(line);
    },
    gracefulTimeoutMs: options.gracefulTimeoutMs,
  });

  let requestedReason: string | null = null;
  let stoppedGracefully = true;

  const requestStop = async (reason: string): Promise<void> => {
    requestedReason = reason;
    const outcome = await handle.requestStop(reason);
    stoppedGracefully = outcome.stoppedGracefully;
  };

  const result: Promise<SupervisedRunResult> = handle.exited.then(async (exitInfo) => {
    let handoffNoteWritten = false;
    if (requestedReason) {
      handoffNoteWritten = await appendHandoffNote(options.cwd, {
        timestamp: now().toISOString(),
        reason: requestedReason,
        stoppedGracefully,
        exitCode: exitInfo.exitCode,
        lastOutputLines: [...lastLines],
      });
    }
    return { ...exitInfo, stopReason: requestedReason, handoffNoteWritten };
  });

  return { pid: handle.pid, requestStop, result };
}
