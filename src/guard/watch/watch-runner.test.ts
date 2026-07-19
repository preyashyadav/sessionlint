import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, appendFile, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { runWatch, WATCH_STATE_FILENAME, type WatchFinding, type WatchOptions } from "./watch-runner";
import type { WatchdogConfig } from "../watchdog/types";

/** JSONL entry shapes mirror the synthetic fixture corpus (and the real shapes verified
 * 2026-07-16: Edit tool_use input keys; Bash tool_result is_error + "Exit code N" content). */

const SESSION_TS = "2026-07-16T12:00:00.000Z";
const SINCE_MS = new Date("2026-07-16T00:00:00.000Z").getTime();

let uuidCounter = 0;
const uid = () => `u${++uuidCounter}`;

interface TurnSpec {
  /** old/new string for an Edit tool_use; null = no edit this turn. */
  edit?: { file: string; oldS: string; newS: string } | null;
  /** Bash test run this turn: command + failure flag + output. */
  bashTest?: { command: string; isError: boolean; output: string };
  timestamp?: string;
}

function buildSessionJsonl(sessionId: string, turns: TurnSpec[]): string {
  const lines: string[] = [];
  let prevUuid: string | null = null;
  for (let i = 0; i < turns.length; i++) {
    const spec = turns[i]!;
    const ts = spec.timestamp ?? SESSION_TS;
    const userUuid = uid();
    lines.push(
      JSON.stringify({
        type: "user", sessionId, version: "2.1.999", promptId: `prompt-${sessionId}-${i}`,
        uuid: userUuid, parentUuid: prevUuid, isSidechain: false, timestamp: ts,
        message: { role: "user", content: `iterate (${i})` }, userType: "external", entrypoint: "cli", cwd: "/x", gitBranch: "main",
      })
    );
    const blocks: unknown[] = [{ type: "text", text: "working" }];
    if (spec.edit) {
      blocks.push({
        type: "tool_use", id: `edit-${sessionId}-${i}`, name: "Edit",
        input: { file_path: spec.edit.file, old_string: spec.edit.oldS, new_string: spec.edit.newS, replace_all: false },
      });
    }
    if (spec.bashTest) {
      blocks.push({ type: "tool_use", id: `bash-${sessionId}-${i}`, name: "Bash", input: { command: spec.bashTest.command } });
    }
    const assistantUuid = uid();
    lines.push(
      JSON.stringify({
        type: "assistant", sessionId, version: "2.1.999",
        uuid: assistantUuid, parentUuid: userUuid, isSidechain: false, timestamp: ts,
        message: {
          model: "claude-haiku-4-5", role: "assistant", content: blocks,
          usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        }, userType: "external", entrypoint: "cli", cwd: "/x", gitBranch: "main",
      })
    );
    prevUuid = assistantUuid;
    if (spec.bashTest) {
      const resultUuid = uid();
      lines.push(
        JSON.stringify({
          type: "user", sessionId, version: "2.1.999", promptId: `prompt-${sessionId}-${i}`,
          uuid: resultUuid, parentUuid: assistantUuid, isSidechain: false, timestamp: ts,
          message: {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: `bash-${sessionId}-${i}`, content: spec.bashTest.output, is_error: spec.bashTest.isError }],
          }, userType: "external", entrypoint: "cli", cwd: "/x", gitBranch: "main",
        })
      );
      prevUuid = resultUuid;
    }
  }
  return lines.join("\n") + "\n";
}

const QUIET_WATCHDOG: WatchdogConfig = { noProgressPolls: 99, identicalDiffIters: 3, repeatedErrorIters: 3 };

async function makeDirs(): Promise<{ sessionsDir: string; projectDir: string }> {
  const base = await mkdtemp(join(tmpdir(), "sessionlint-watch-"));
  const sessionsDir = join(base, "sessions");
  const projectDir = join(base, "project");
  await mkdir(sessionsDir, { recursive: true });
  await mkdir(projectDir, { recursive: true });
  return { sessionsDir, projectDir };
}

function baseOptions(dirs: { sessionsDir: string; projectDir: string }, overrides: Partial<WatchOptions> = {}): WatchOptions {
  return {
    sessionsDir: dirs.sessionsDir,
    projectDir: dirs.projectDir,
    pollIntervalMs: 1,
    sinceMs: SINCE_MS,
    watchdog: QUIET_WATCHDOG,
    maxPolls: 3,
    ...overrides,
  };
}

describe("runWatch detectors (transcript-native TP/TN through the real runner)", () => {
  test("identical-diffs: 3 turns with byte-identical edit signatures trip; state file written", async () => {
    const dirs = await makeDirs();
    const spec = { edit: { file: "src/a.ts", oldS: "x", newS: "y" } };
    await writeFile(join(dirs.sessionsDir, "s1.jsonl"), buildSessionJsonl("s1", [spec, spec, spec]));

    const result = await runWatch(baseOptions(dirs));
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.reason).toBe("identical-diffs");
    expect(result.findings[0]!.sessionId).toBe("s1");

    const state = JSON.parse(await readFile(join(dirs.projectDir, ".sessionlint", WATCH_STATE_FILENAME), "utf8"));
    expect(state.tripped).toBe(true);
    expect(state.reason).toBe("identical-diffs");
  });

  test("oscillation: A→B→A edit signatures trip", async () => {
    const dirs = await makeDirs();
    const a = { edit: { file: "src/a.ts", oldS: "x", newS: "y" } };
    const b = { edit: { file: "src/a.ts", oldS: "y", newS: "x" } };
    await writeFile(join(dirs.sessionsDir, "s1.jsonl"), buildSessionJsonl("s1", [a, b, a]));

    const result = await runWatch(baseOptions(dirs));
    expect(result.findings.map((f) => f.reason)).toEqual(["oscillation"]);
  });

  test("repeated-error: same pattern-matched test failure 3 turns running trips (distinct edits)", async () => {
    const dirs = await makeDirs();
    const failing = (i: number): TurnSpec => ({
      edit: { file: "src/a.ts", oldS: `attempt${i}`, newS: `attempt${i + 1}` },
      bashTest: { command: "bun test", isError: true, output: "Exit code 1\nFAIL foo.test.ts > adds numbers" },
    });
    await writeFile(join(dirs.sessionsDir, "s1.jsonl"), buildSessionJsonl("s1", [failing(1), failing(2), failing(3)]));

    const result = await runWatch(baseOptions(dirs, { testPattern: "bun test" }));
    expect(result.findings.map((f) => f.reason)).toEqual(["repeated-error"]);
  });

  test("no-new-commits: an active session that goes quiet for N polls trips", async () => {
    const dirs = await makeDirs();
    await writeFile(join(dirs.sessionsDir, "s1.jsonl"), buildSessionJsonl("s1", [{ edit: { file: "a.ts", oldS: "x", newS: "y" } }]));

    const result = await runWatch(
      baseOptions(dirs, { watchdog: { ...QUIET_WATCHDOG, noProgressPolls: 3 }, maxPolls: 6 })
    );
    expect(result.findings.map((f) => f.reason)).toEqual(["no-new-commits"]);
  });

  test("healthy session (distinct edits, passing tests): zero findings (TN)", async () => {
    const dirs = await makeDirs();
    const turns: TurnSpec[] = [1, 2, 3, 4].map((i) => ({
      edit: { file: `src/f${i}.ts`, oldS: `old${i}`, newS: `new${i}` },
      bashTest: { command: "bun test", isError: false, output: "All tests passed" },
    }));
    await writeFile(join(dirs.sessionsDir, "s1.jsonl"), buildSessionJsonl("s1", turns));

    const result = await runWatch(baseOptions(dirs, { testPattern: "bun test" }));
    expect(result.findings).toEqual([]);
  });

  test("a trip fires ONCE, not on every subsequent poll", async () => {
    const dirs = await makeDirs();
    const spec = { edit: { file: "src/a.ts", oldS: "x", newS: "y" } };
    await writeFile(join(dirs.sessionsDir, "s1.jsonl"), buildSessionJsonl("s1", [spec, spec, spec]));

    const result = await runWatch(baseOptions(dirs, { maxPolls: 5 }));
    expect(result.findings).toHaveLength(1);
  });
});

describe("runWatch budget (project-level, via injected cost source)", () => {
  test("crossing --budget emits a budget finding once", async () => {
    const dirs = await makeDirs();
    let cost = 0.5;
    const result = await runWatch(baseOptions(dirs, { budgetUsd: 2.0, maxPolls: 4 }), {
      costSince: async () => ({ costUsd: (cost += 1.0), dataFound: true }),
    });
    expect(result.findings.map((f) => f.reason)).toEqual(["budget"]);
    expect(result.findings[0]!.sessionId).toBeNull();
  });

  test("dataFound:false never trips budget (unknown ≠ $0 — C-1 posture)", async () => {
    const dirs = await makeDirs();
    const result = await runWatch(baseOptions(dirs, { budgetUsd: 0.01, maxPolls: 3 }), {
      costSince: async () => ({ costUsd: 0, dataFound: false }),
    });
    expect(result.findings).toEqual([]);
  });
});

describe("runWatch robustness (test-gate requirements)", () => {
  test("session file created MID-watch is picked up and judged", async () => {
    const dirs = await makeDirs();
    const spec = { edit: { file: "src/a.ts", oldS: "x", newS: "y" } };
    let sleeps = 0;
    const result = await runWatch(baseOptions(dirs, { maxPolls: 4 }), {
      sleep: async () => {
        sleeps++;
        if (sleeps === 2) await writeFile(join(dirs.sessionsDir, "late.jsonl"), buildSessionJsonl("late", [spec, spec, spec]));
      },
    });
    expect(result.findings.map((f) => f.reason)).toEqual(["identical-diffs"]);
    expect(result.findings[0]!.sessionId).toBe("late");
  });

  test("partial trailing line (mid-write) degrades gracefully, then recovers when completed", async () => {
    const dirs = await makeDirs();
    const spec = { edit: { file: "src/a.ts", oldS: "x", newS: "y" } };
    const full = buildSessionJsonl("s1", [spec, spec, spec]);
    const lines = full.trimEnd().split("\n");
    const lastLine = lines[lines.length - 1]!;
    const truncated = lines.slice(0, -1).join("\n") + "\n" + lastLine.slice(0, 40); // cut mid-JSON
    await writeFile(join(dirs.sessionsDir, "s1.jsonl"), truncated);

    let sleeps = 0;
    const result = await runWatch(baseOptions(dirs, { maxPolls: 4 }), {
      sleep: async () => {
        sleeps++;
        if (sleeps === 2) await appendFile(join(dirs.sessionsDir, "s1.jsonl"), lastLine.slice(40) + "\n");
      },
    });
    // No crash on the partial line, and the completed line still produces the trip.
    expect(result.findings.map((f) => f.reason)).toEqual(["identical-diffs"]);
  });

  test("unknown schema version / unknown entry types: no crash, no findings", async () => {
    const dirs = await makeDirs();
    const weird =
      JSON.stringify({ type: "hologram-v9", sessionId: "s1", version: "99.0.0", uuid: "w1", payload: { future: true } }) +
      "\n" +
      JSON.stringify({ type: "another-unknown", uuid: "w2" }) +
      "\n";
    await writeFile(join(dirs.sessionsDir, "s1.jsonl"), weird);

    const result = await runWatch(baseOptions(dirs));
    expect(result.findings).toEqual([]);
    expect(result.sessionsSeen).toBe(1);
  });

  test("5 concurrent session files: independent state, only the stuck one trips", async () => {
    const dirs = await makeDirs();
    const stuck = { edit: { file: "src/a.ts", oldS: "x", newS: "y" } };
    for (let i = 1; i <= 4; i++) {
      const healthy: TurnSpec[] = [1, 2, 3].map((j) => ({ edit: { file: `f${i}-${j}.ts`, oldS: `o${j}`, newS: `n${j}` } }));
      await writeFile(join(dirs.sessionsDir, `healthy-${i}.jsonl`), buildSessionJsonl(`healthy-${i}`, healthy));
    }
    await writeFile(join(dirs.sessionsDir, "stuck.jsonl"), buildSessionJsonl("stuck", [stuck, stuck, stuck]));

    const result = await runWatch(baseOptions(dirs));
    expect(result.sessionsSeen).toBe(5);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.sessionId).toBe("stuck");
  });

  test("pre-watch history never trips: turns older than sinceMs are not judged", async () => {
    const dirs = await makeDirs();
    const spec: TurnSpec = { edit: { file: "src/a.ts", oldS: "x", newS: "y" }, timestamp: "2026-07-15T00:00:00.000Z" };
    await writeFile(join(dirs.sessionsDir, "old.jsonl"), buildSessionJsonl("old", [spec, spec, spec]));

    const result = await runWatch(baseOptions(dirs, { watchdog: { ...QUIET_WATCHDOG, noProgressPolls: 2 }, maxPolls: 5 }));
    expect(result.findings).toEqual([]);
  });

  test("sessions dir does not exist yet: keeps polling without crashing", async () => {
    const dirs = await makeDirs();
    const result = await runWatch(baseOptions(dirs, { sessionsDir: join(dirs.sessionsDir, "not-yet") }));
    expect(result.pollsRun).toBe(3);
    expect(result.findings).toEqual([]);
  });
});

describe("runWatch trip-state lifecycle", () => {
  test("a stale trip from a previous run is cleared when a new watch starts", async () => {
    const dirs = await makeDirs();
    await mkdir(join(dirs.projectDir, ".sessionlint"), { recursive: true });
    await writeFile(
      join(dirs.projectDir, ".sessionlint", WATCH_STATE_FILENAME),
      JSON.stringify({ tripped: true, reason: "identical-diffs", detail: "old run" })
    );

    await runWatch(baseOptions(dirs, { maxPolls: 1 }));
    const state = JSON.parse(await readFile(join(dirs.projectDir, ".sessionlint", WATCH_STATE_FILENAME), "utf8"));
    expect(state.tripped).toBe(false);
  });
});

describe("runWatch tier 1 (notify/webhook)", () => {
  test("notify + webhook fire on a trip with the finding payload", async () => {
    const dirs = await makeDirs();
    const spec = { edit: { file: "src/a.ts", oldS: "x", newS: "y" } };
    await writeFile(join(dirs.sessionsDir, "s1.jsonl"), buildSessionJsonl("s1", [spec, spec, spec]));

    const notifications: string[] = [];
    const webhookCalls: Array<{ url: string; payload: WatchFinding }> = [];
    await runWatch(baseOptions(dirs, { notify: true, webhookUrl: "https://example.test/hook" }), {
      notifier: async (_title, body) => {
        notifications.push(body);
        return true;
      },
      webhookPost: async (url, payload) => {
        webhookCalls.push({ url, payload });
        return true;
      },
    });

    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toContain("identical-diffs");
    expect(webhookCalls).toHaveLength(1);
    expect(webhookCalls[0]!.url).toBe("https://example.test/hook");
    expect(webhookCalls[0]!.payload.reason).toBe("identical-diffs");
  });

  test("tier 0 default: no notifier/webhook deps are ever required", async () => {
    const dirs = await makeDirs();
    const spec = { edit: { file: "src/a.ts", oldS: "x", newS: "y" } };
    await writeFile(join(dirs.sessionsDir, "s1.jsonl"), buildSessionJsonl("s1", [spec, spec, spec]));
    const result = await runWatch(baseOptions(dirs)); // no deps at all
    expect(result.findings).toHaveLength(1);
  });
});
