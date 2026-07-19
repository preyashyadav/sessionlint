/**
 * Phase 5 Task 2: `sessionlint watch` — supervise ANY autonomous run (official
 * ralph-loop plugin, GSD, custom in-session loops) by tailing the session
 * transcripts Claude Code already writes, instead of wrapping a process.
 * Feeds the SAME evaluateWatchdog detector codebase as `sessionlint loop`;
 * only the signal source differs (transcript turns vs. git commits).
 *
 * Read-only by default (D-003): Tier 0 emits findings and records trip state;
 * Tier 1 (--notify / --webhook) sends notifications; watch NEVER kills
 * anything — hard-stopping an in-session loop requires the user-installed
 * hook (`sessionlint install-hook`), which reads the trip-state file this
 * runner writes.
 *
 * Tailing strategy: poll the sessions directory and fully reload changed
 * files through the existing C-1 adapter (loadSession) rather than running a
 * second, incremental JSONL parser. The adapter already tolerates partial
 * trailing lines (counted as parse errors, never a crash) and unknown entry
 * types (classified "unknown"), so every robustness requirement rides on
 * already-tested code. Change detection is size+mtime; a shrunken file
 * (rotation/truncation) simply reloads from scratch.
 */

import { readdir, stat, mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { loadSession } from "../../adapters/claude-code/session";
import { evaluateWatchdog } from "../watchdog/detectors";
import { costSince as realCostSince, type ProjectCostSinceResult } from "../loop/project-cost";
import { sessionIterationRecords, type TranscriptSignalOptions } from "./signals";
import type { IterationRecord, WatchdogConfig, WatchdogTripReason } from "../watchdog/types";

export type WatchFindingReason = WatchdogTripReason | "budget";

export interface WatchFinding {
  sessionId: string | null; // null for project-level findings (budget)
  reason: WatchFindingReason;
  detail: string;
  atMs: number;
}

export interface WatchOptions {
  /** Directory of session .jsonl files to tail (the encoded project dir under
   * ~/.claude/projects in real use; any dir in tests). May not exist yet. */
  sessionsDir: string;
  /** The real project directory — trip-state file location and budget attribution. */
  projectDir: string;
  pollIntervalMs: number;
  /** Turns starting before this are pre-watch history and never judged. */
  sinceMs: number;
  watchdog: WatchdogConfig;
  budgetUsd?: number;
  testPattern?: string;
  notify?: boolean;
  webhookUrl?: string;
  /** Stop after this many polls (tests / bounded runs). Omit = run until stopped. */
  maxPolls?: number;
}

export interface WatchDeps {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  costSince?: (projectDir: string, sinceMs: number) => Promise<ProjectCostSinceResult>;
  notifier?: (title: string, body: string) => Promise<boolean>;
  webhookPost?: (url: string, payload: WatchFinding) => Promise<boolean>;
  onFinding?: (finding: WatchFinding) => void;
}

export interface WatchResult {
  pollsRun: number;
  findings: WatchFinding[];
  sessionsSeen: number;
}

interface SessionWatchState {
  size: number;
  mtimeMs: number;
  records: IterationRecord[];
  pollsSinceNewIteration: number;
  /** Reasons already reported for this session — each fires once, not every poll. */
  reported: Set<WatchFindingReason>;
  /** Only sessions that produced ≥1 record since the watch started are judged for
   * no-progress — a stale pre-existing file must never trip "no-new-commits". */
  active: boolean;
}

export const WATCH_STATE_FILENAME = "watch-state.json";

async function writeTripState(projectDir: string, finding: WatchFinding): Promise<void> {
  const dir = join(projectDir, ".sessionlint");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, WATCH_STATE_FILENAME),
    JSON.stringify({ tripped: true, reason: finding.reason, sessionId: finding.sessionId, detail: finding.detail, at: new Date(finding.atMs).toISOString() }, null, 2)
  );
}

/** A stale trip from a PREVIOUS run must not gate a new one — runWatch clears it at start,
 * and `sessionlint hook-gate --clear` is the manual unblock. */
export async function clearTripState(projectDir: string): Promise<void> {
  const dir = join(projectDir, ".sessionlint");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, WATCH_STATE_FILENAME), JSON.stringify({ tripped: false }, null, 2));
}

export async function runWatch(options: WatchOptions, deps: WatchDeps = {}): Promise<WatchResult> {
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => Bun.sleep(ms));
  const costSince = deps.costSince ?? ((projectDir: string, sinceMs: number) => realCostSince(projectDir, sinceMs));
  const signalOptions: TranscriptSignalOptions = { testPattern: options.testPattern };

  const sessions = new Map<string, SessionWatchState>();
  const findings: WatchFinding[] = [];
  let budgetReported = false;
  let pollsRun = 0;

  // Best-effort: a leftover trip from a previous run must not block this one's session.
  try {
    await clearTripState(options.projectDir);
  } catch {}

  const emit = async (finding: WatchFinding): Promise<void> => {
    findings.push(finding);
    deps.onFinding?.(finding);
    // Trip state persists regardless of tier — it's what hook-gate enforcement reads.
    // Best-effort: a state-write failure must not take down a read-only observer.
    try {
      await writeTripState(options.projectDir, finding);
    } catch {}
    if (options.notify && deps.notifier) {
      try {
        await deps.notifier("sessionlint watch", `${finding.reason}: ${finding.detail}`);
      } catch {}
    }
    if (options.webhookUrl && deps.webhookPost) {
      try {
        await deps.webhookPost(options.webhookUrl, finding);
      } catch {}
    }
  };

  while (options.maxPolls === undefined || pollsRun < options.maxPolls) {
    if (pollsRun > 0) await sleep(options.pollIntervalMs);
    pollsRun++;

    // The sessions dir may not exist yet (watch started before the first Claude Code
    // turn ever ran in this project) — keep polling, don't crash (C-1 posture).
    let fileNames: string[] = [];
    try {
      fileNames = (await readdir(options.sessionsDir)).filter((f) => f.endsWith(".jsonl"));
    } catch {}

    for (const fileName of fileNames) {
      const filePath = join(options.sessionsDir, fileName);
      let fileStat;
      try {
        fileStat = await stat(filePath);
      } catch {
        continue; // deleted between readdir and stat — next poll sees the truth
      }

      let state = sessions.get(fileName);
      if (!state) {
        state = { size: -1, mtimeMs: -1, records: [], pollsSinceNewIteration: 0, reported: new Set(), active: false };
        sessions.set(fileName, state);
      }

      let newIterationSeen = false;
      if (fileStat.size !== state.size || fileStat.mtimeMs !== state.mtimeMs) {
        state.size = fileStat.size;
        state.mtimeMs = fileStat.mtimeMs;
        try {
          const { session } = await loadSession(filePath);
          const records = sessionIterationRecords(session, options.sinceMs, signalOptions);
          newIterationSeen = records.length > state.records.length;
          state.records = records;
          if (records.length > 0) state.active = true;
        } catch {
          continue; // unreadable this poll (mid-write, permissions) — degrade, retry next poll
        }
      }

      if (newIterationSeen) state.pollsSinceNewIteration = 0;
      else if (state.active) state.pollsSinceNewIteration++;

      if (!state.active) continue;

      const tripped = evaluateWatchdog(state.records, state.pollsSinceNewIteration, options.watchdog);
      if (tripped && !state.reported.has(tripped)) {
        state.reported.add(tripped);
        const detail =
          tripped === "no-new-commits"
            ? `no new turns for ${state.pollsSinceNewIteration} polls in session ${fileName}`
            : `${tripped} across recent turns in session ${fileName}`;
        await emit({ sessionId: fileName.replace(/\.jsonl$/, ""), reason: tripped, detail, atMs: now() });
      }
    }

    if (options.budgetUsd !== undefined && !budgetReported) {
      const cost = await costSince(options.projectDir, options.sinceMs);
      if (cost.dataFound && cost.costUsd >= options.budgetUsd) {
        budgetReported = true;
        await emit({
          sessionId: null,
          reason: "budget",
          detail: `spend since watch start ($${cost.costUsd.toFixed(2)}) crossed the $${options.budgetUsd.toFixed(2)} budget`,
          atMs: now(),
        });
      }
    }
  }

  return { pollsRun, findings, sessionsSeen: sessions.size };
}
