/**
 * Phase 4 Task 1: generic child-process supervisor. Must work over ANY
 * command tree (a plain bash loop, the official plugin, GSD) without
 * assuming a structured output format — Task 3's spec is explicit that the
 * loop wrapper works "without modifying" whatever it wraps. So this cannot
 * parse the child's stdout for turn boundaries; "clean checkpoint" for an
 * arbitrary opaque child means: send SIGTERM and give it a real grace
 * period to exit on its own (the standard Unix contract — a well-behaved
 * child finishes its current unit of work on SIGTERM), then SIGKILL only if
 * it doesn't. sessionlint's own contribution to a "clean" stop is the
 * handoff note (handoff-note.ts), not omniscient introspection into a
 * process it doesn't control.
 */

export interface SupervisorOptions {
  command: string[];
  cwd?: string;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
  /** How long to wait after SIGTERM before escalating to SIGKILL. */
  gracefulTimeoutMs?: number;
}

export interface ExitInfo {
  exitCode: number | null;
  signalCode: string | null;
}

export interface StopOutcome {
  reason: string;
  stoppedGracefully: boolean;
}

export interface SupervisorHandle {
  pid: number;
  requestStop(reason: string): Promise<StopOutcome>;
  exited: Promise<ExitInfo>;
}

const DEFAULT_GRACEFUL_TIMEOUT_MS = 10_000;

export function startSupervisedProcess(options: SupervisorOptions): SupervisorHandle {
  const proc = Bun.spawn(options.command, {
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  void drainLines(proc.stdout, options.onStdoutLine);
  void drainLines(proc.stderr, options.onStderrLine);

  const exited: Promise<ExitInfo> = proc.exited.then((exitCode) => ({
    exitCode,
    signalCode: proc.signalCode ?? null,
  }));

  let stopInFlight: Promise<StopOutcome> | null = null;

  async function requestStop(reason: string): Promise<StopOutcome> {
    if (stopInFlight) return stopInFlight;
    stopInFlight = (async () => {
      proc.kill("SIGTERM");
      const gracefulTimeoutMs = options.gracefulTimeoutMs ?? DEFAULT_GRACEFUL_TIMEOUT_MS;
      const outcome = await Promise.race([
        exited.then(() => "exited" as const),
        Bun.sleep(gracefulTimeoutMs).then(() => "timed-out" as const),
      ]);
      if (outcome === "timed-out") {
        proc.kill("SIGKILL");
        await exited;
        return { reason, stoppedGracefully: false };
      }
      return { reason, stoppedGracefully: true };
    })();
    return stopInFlight;
  }

  return { pid: proc.pid, requestStop, exited };
}

/** Reads a stream to completion line-by-line, always draining it even with no callback —
 * an unread pipe can otherwise block the child process once its OS pipe buffer fills. */
async function drainLines(stream: ReadableStream<Uint8Array> | null, onLine?: (line: string) => void): Promise<void> {
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        onLine?.(buffer.slice(0, newlineIndex));
        buffer = buffer.slice(newlineIndex + 1);
      }
    }
    if (buffer.length > 0) onLine?.(buffer);
  } finally {
    reader.releaseLock();
  }
}
