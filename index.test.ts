/**
 * Regression test for the sessionlint CLI entry (Phase 1, Task 5 gate).
 * Runs index.ts as a subprocess against a synthetic project directory built
 * from fixtures/synthetic/, so it never touches a real ~/.claude/projects tree.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, copyFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const ENTRY_PATH = join(import.meta.dir, "index.ts");
const SYNTHETIC_DIR = join(import.meta.dir, "fixtures", "synthetic");

let fixtureRoot: string;

beforeEach(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), "sessionlint-cli-"));
});

afterEach(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", ENTRY_PATH, "--dir", fixtureRoot, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

async function runCliRaw(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", ENTRY_PATH, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HOME: fixtureRoot },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

async function runStatuslineCli(stdinText: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // HOME is overridden so defaultStateFilePath() (~/.sessionlint/burn-state.json) resolves
  // into the disposable fixtureRoot instead of the real machine's home directory.
  const proc = Bun.spawn(["bun", "run", ENTRY_PATH, "statusline"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HOME: fixtureRoot },
  });
  proc.stdin.write(stdinText);
  proc.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

async function seedProject(fixtureFile: string): Promise<void> {
  const projectDir = join(fixtureRoot, "test-project");
  await mkdir(projectDir, { recursive: true });
  await copyFile(join(SYNTHETIC_DIR, fixtureFile), join(projectDir, fixtureFile));
}

describe("sessionlint CLI", () => {
  test("empty root: no crash, friendly message", async () => {
    const { stdout, stderr, exitCode } = await runCli([]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("No session files found");
  });

  test("unreadable --dir: clean one-line error by default, not a raw stack trace", async () => {
    const proc = Bun.spawn(["bun", "run", ENTRY_PATH, "--dir", "/nonexistent-test-dir-xyz"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    expect(exitCode).toBe(1);
    expect(stderr.trim().split("\n")).toHaveLength(1);
    expect(stderr).toContain("sessionlint error:");
    expect(stderr).toContain("is Claude Code installed?");
  });

  test("SESSIONLINT_DEBUG=1 shows the full error for unexpected bugs", async () => {
    const proc = Bun.spawn(["bun", "run", ENTRY_PATH, "--dir", "/nonexistent-test-dir-xyz"], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, SESSIONLINT_DEBUG: "1" },
    });
    const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    expect(exitCode).toBe(1);
    expect(stderr.split("\n").length).toBeGreaterThan(1);
  });

  test("terminal report on a flagged session", async () => {
    await seedProject("model-switch.jsonl");
    const { stdout, stderr, exitCode } = await runCli([]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("sessionlint · 1 session analyzed");
    expect(stdout).toContain("⚠ CACHE-NUKE");
  });

  test("--json produces valid, parseable JSON with the finding", async () => {
    await seedProject("model-switch.jsonl");
    const { stdout, exitCode } = await runCli(["--json"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.flaggedSessions[0].findings[0].ruleId).toBe("cache-nuke");
  });

  test("--md produces a markdown heading", async () => {
    await seedProject("model-switch.jsonl");
    const { stdout, exitCode } = await runCli(["--md"]);
    expect(exitCode).toBe(0);
    expect(stdout).toStartWith("# sessionlint report");
  });

  test("--suppress removes the named rule's findings", async () => {
    await seedProject("model-switch.jsonl");
    const { stdout, exitCode } = await runCli(["--json", "--suppress", "cache-nuke"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.flaggedSessions).toEqual([]);
  });

  test("--verify against an empty fixture dir finds no candidates and makes no API calls", async () => {
    const { stdout, exitCode } = await runCli(["--verify"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("No downgrade-candidate turns found");
  });

  test("--verify on a non-interactive terminal without --yes declines and makes no API calls", async () => {
    await seedProject("model-switch.jsonl");
    const { stdout, stderr, exitCode } = await runCli(["--verify"]);
    expect(exitCode).toBe(0);
    expect(stderr).toContain("Non-interactive terminal detected");
    expect(stdout).toContain("Verify cancelled — no API calls were made.");
  });

  test("--verify --paranoid gives the paranoid-specific refusal message", async () => {
    const { stderr, exitCode } = await runCli(["--verify", "--paranoid"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("--paranoid blocks SessionLint-owned API calls");
  });

  test("statusline reads stdin JSON and prints a gauge line", async () => {
    const stdin = JSON.stringify({ rate_limits: { five_hour: { used_percentage: 7, resets_at: 9_999_999_999 } } });
    const { stdout, exitCode } = await runStatuslineCli(stdin);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("7%");
  });

  test("statusline degrades gracefully on invalid JSON, no crash", async () => {
    const { stdout, exitCode } = await runStatuslineCli("not json");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("sessionlint: invalid statusline input");
  });

  test("hook user-prompt-submit produces no output and exits 0 with no burn history", async () => {
    const proc = Bun.spawn(["bun", "run", ENTRY_PATH, "hook", "user-prompt-submit"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, HOME: fixtureRoot },
    });
    proc.stdin.write(JSON.stringify({ cwd: fixtureRoot, hook_event_name: "UserPromptSubmit" }));
    proc.stdin.end();
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("");
  });

  test("auto-delegate writes settings.local.json under the given --project-dir and is honest about timing", async () => {
    const { stdout, exitCode } = await runCliRaw(["auto-delegate", "haiku", "--project-dir", fixtureRoot]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("NEXT Claude Code session");
    const written = JSON.parse(await Bun.file(join(fixtureRoot, ".claude", "settings.local.json")).text());
    expect(written).toEqual({ env: { CLAUDE_CODE_SUBAGENT_MODEL: "haiku" } });
  });

  test("auto-delegate off reverses a prior enable, preserving unrelated settings", async () => {
    const settingsPath = join(fixtureRoot, ".claude", "settings.local.json");
    await mkdir(join(fixtureRoot, ".claude"), { recursive: true });
    await Bun.write(settingsPath, JSON.stringify({ permissions: { allow: ["Bash(git *)"] } }, null, 2));
    await runCliRaw(["auto-delegate", "haiku", "--project-dir", fixtureRoot]);
    const { stdout, exitCode } = await runCliRaw(["auto-delegate", "off", "--project-dir", fixtureRoot]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("disabled");
    const written = JSON.parse(await Bun.file(settingsPath).text());
    expect(written).toEqual({ permissions: { allow: ["Bash(git *)"] } });
  });

  test("auto-delegate with no model/off argument prints usage and exits 1", async () => {
    const { stderr, exitCode } = await runCliRaw(["auto-delegate", "--project-dir", fixtureRoot]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Usage: sessionlint auto-delegate");
  });

  test("budget set/status/off round-trip, isolated to a fake HOME", async () => {
    const env = { ...process.env, HOME: fixtureRoot };
    const set = Bun.spawn(["bun", "run", ENTRY_PATH, "budget", "set", "25"], { stdout: "pipe", env });
    expect(await new Response(set.stdout).text()).toContain("$25.00");
    await set.exited;

    const status = Bun.spawn(["bun", "run", ENTRY_PATH, "budget", "status"], { stdout: "pipe", env });
    expect(await new Response(status.stdout).text()).toContain("$25.00");
    await status.exited;

    const off = Bun.spawn(["bun", "run", ENTRY_PATH, "budget", "off"], { stdout: "pipe", env });
    expect(await new Response(off.stdout).text()).toContain("cleared");
    await off.exited;

    const statusAfter = Bun.spawn(["bun", "run", ENTRY_PATH, "budget", "status"], { stdout: "pipe", env });
    expect(await new Response(statusAfter.stdout).text()).toContain("no session budget set");
  });

  test("budget set with an invalid amount errors instead of writing garbage", async () => {
    const proc = Bun.spawn(["bun", "run", ENTRY_PATH, "budget", "set", "not-a-number"], {
      stderr: "pipe",
      env: { ...process.env, HOME: fixtureRoot },
    });
    const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Usage: sessionlint budget set");
  });

  test("statusline also fires the credits sentinel when a budget is configured and crossed", async () => {
    // SESSIONLINT_NO_NOTIFY avoids a real OS desktop-notification popup during this test.
    const env = { ...process.env, HOME: fixtureRoot, SESSIONLINT_NO_NOTIFY: "1" };
    const budgetSet = Bun.spawn(["bun", "run", ENTRY_PATH, "budget", "set", "10"], { stdout: "pipe", env });
    await budgetSet.exited;

    const proc = Bun.spawn(["bun", "run", ENTRY_PATH, "statusline"], { stdin: "pipe", stdout: "pipe", env });
    proc.stdin.write(JSON.stringify({ session_id: "s1", cost: { total_cost_usd: 6 } }));
    proc.stdin.end();
    const stdout = await new Response(proc.stdout).text();
    expect(stdout).toContain("50%");
  });

  // These test only the declined/usage-error paths — never a confirmed run, since that would
  // make a real, billed `claude -p` call (the CLI wires runRunCommand directly to
  // realClaudeRunner, with no injection point at this layer; the fake-driven ladder logic
  // itself is covered separately in src/guard/run/*.test.ts).
  test("run with missing required flags prints usage and exits 1", async () => {
    const { stderr, exitCode } = await runCliRaw(["run", "--prompt", "do it"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Usage: sessionlint run");
  });

  test("run --paranoid refuses before any confirm prompt", async () => {
    const { stderr, exitCode } = await runCliRaw([
      "run",
      "--paranoid",
      "--prompt",
      "do it",
      "--model-ladder",
      "haiku",
      "--success-check",
      "true",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("--paranoid blocks SessionLint-owned API calls");
  });

  test("run rejects shell operators in --success-check instead of silently mis-parsing them", async () => {
    const { stderr, exitCode } = await runCliRaw([
      "run",
      "--prompt",
      "do it",
      "--model-ladder",
      "haiku",
      "--success-check",
      "npm test && ./verify.sh",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("does not invoke a shell");
  });

  test("watch --paranoid refuses a webhook before discovery or polling", async () => {
    const { stderr, exitCode } = await runCliRaw([
      "watch",
      "--paranoid",
      "--webhook",
      "https://example.invalid/hook",
      "--max-polls",
      "1",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("blocks SessionLint-owned webhook/API calls");
  });

  test("run on a non-interactive terminal without --yes cancels, making no real API calls", async () => {
    const { stdout, stderr, exitCode } = await runCliRaw([
      "run",
      "--prompt",
      "do it",
      "--model-ladder",
      "haiku,sonnet",
      "--success-check",
      "true",
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).toContain("Non-interactive terminal detected");
    expect(stdout).toContain("cancelled — no API calls were made");
  });

  test("loop with no -- <cmd> prints usage and exits 1", async () => {
    const { stderr, exitCode } = await runCliRaw(["loop", "--budget", "5"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Usage: sessionlint loop");
  });

  test("loop wraps a real command and reports its natural exit, with no local cost data to poll", async () => {
    const { stdout, exitCode } = await runCliRaw([
      "loop",
      "--project-dir",
      fixtureRoot,
      "--poll-interval",
      "0.05",
      "--",
      "bash",
      "-c",
      "exit 0",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Child exited on its own");
  });

  test("hook user-prompt-submit never blocks on malformed stdin", async () => {
    const proc = Bun.spawn(["bun", "run", ENTRY_PATH, "hook", "user-prompt-submit"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, HOME: fixtureRoot },
    });
    proc.stdin.write("not json");
    proc.stdin.end();
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
  });

  test("clean session (no findings) is not flagged", async () => {
    await seedProject("minimal-session.jsonl");
    const { stdout, exitCode } = await runCli([]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("sessionlint · 1 session analyzed");
    expect(stdout).toContain("0 findings across 0 flagged sessions");
  });
});

describe("utility commands (help, version, explain, doctor, sessions)", () => {
  test("help lists every command group and known subcommand", async () => {
    const { stdout, exitCode } = await runCliRaw(["help"]);
    expect(exitCode).toBe(0);
    for (const expected of ["AUDIT", "LIVE SESSION", "AUTONOMOUS RUNS", "sessions", "explain", "doctor", "watch", "loop", "--verify"]) {
      expect(stdout).toContain(expected);
    }
  });

  test("--help and -h reach the same help text", async () => {
    const a = await runCliRaw(["--help"]);
    const b = await runCliRaw(["-h"]);
    expect(a.stdout).toBe(b.stdout);
    expect(a.stdout).toContain("AUDIT");
  });

  test("version prints the version and exits 0", async () => {
    const { stdout, exitCode } = await runCliRaw(["version"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("0.1.0");
  });

  test("explain with no arg lists all five rules", async () => {
    const { stdout, exitCode } = await runCliRaw(["explain"]);
    expect(exitCode).toBe(0);
    for (const id of ["cache-nuke", "late-compaction", "giant-file-read", "missing-clear-at-topic-boundary", "repeated-identical-prompt"]) {
      expect(stdout).toContain(id);
    }
  });

  test("explain <rule> prints detection, cost, and fix sections", async () => {
    const { stdout, exitCode } = await runCliRaw(["explain", "cache-nuke"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("What it detects");
    expect(stdout).toContain("How to fix it");
    expect(stdout).toContain("How the $ range is computed");
  });

  test("explain with an unknown rule fails with the known-rule list", async () => {
    const { stderr, exitCode } = await runCliRaw(["explain", "no-such-rule"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Unknown rule");
    expect(stderr).toContain("cache-nuke");
  });

  test("doctor reports root, counts, and pricing freshness against an empty config dir", async () => {
    const proc = Bun.spawn(["bun", "run", ENTRY_PATH, "doctor"], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, CLAUDE_CONFIG_DIR: fixtureRoot },
    });
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("environment check");
    expect(stdout).toContain(fixtureRoot);
    expect(stdout).toContain("pricing table");
  });

  test("sessions lists a seeded session with id, turns, and a cost column", async () => {
    await seedProject("model-switch.jsonl");
    const { stdout, exitCode } = await runCliRaw(["sessions", "--dir", fixtureRoot]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("session(s)");
    expect(stdout).toContain("est. cost");
    expect(stdout).toContain("$");
  });

  test("an unknown subcommand errors instead of silently running the linter", async () => {
    const { stderr, exitCode } = await runCliRaw(["bogus-command"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('Unknown command "bogus-command"');
  });
});

describe("--ci gate", () => {
  test("no findings meeting the threshold: JSON to stdout, exit 0", async () => {
    await seedProject("minimal-session.jsonl"); // one turn, one model — zero findings
    const { stdout, exitCode } = await runCli(["--ci"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(parsed.totalFindings).toBe(0);
  });

  test("a finding at/above --fail-on exits 1 (still prints JSON)", async () => {
    await seedProject("missing-clear.jsonl"); // produces at least one finding
    const { stdout, exitCode } = await runCli(["--ci", "--fail-on", "info"]);
    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout).totalFindings).toBeGreaterThan(0);
  });

  test("findings below --fail-on do not fail the build", async () => {
    // missing-clear is a warning-tier finding; failing only on error must exit 0.
    await seedProject("missing-clear.jsonl");
    const { exitCode } = await runCli(["--ci", "--fail-on", "error"]);
    expect(exitCode).toBe(0);
  });

  test("invalid --fail-on value exits 2 with a usage error", async () => {
    await seedProject("minimal-session.jsonl");
    const { stderr, exitCode } = await runCli(["--ci", "--fail-on", "nonsense"]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("--fail-on must be one of");
  });
});

describe("export --redact", () => {
  test("refuses to run without --redact (no accidental raw export)", async () => {
    const { stderr, exitCode } = await runCliRaw(["export", "--dir", fixtureRoot]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("requires --redact");
  });

  test("writes a redacted, flattened session file", async () => {
    await seedProject("model-switch.jsonl");
    const outDir = await mkdtemp(join(tmpdir(), "sessionlint-cli-export-"));
    const { stdout, exitCode } = await runCliRaw(["export", "--redact", "--dir", fixtureRoot, "--out", outDir]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("redacted transcript");
    expect(stdout).toContain("REVIEW the output before sharing");
    const { readdir } = await import("fs/promises");
    expect((await readdir(outDir)).sort()).toEqual(["MANIFEST.md", "session-001.jsonl"]);
    await rm(outDir, { recursive: true, force: true });
  });

  test("--dry-run shows what would be shared but writes nothing", async () => {
    await seedProject("model-switch.jsonl");
    const outDir = await mkdtemp(join(tmpdir(), "sessionlint-cli-dry-"));
    const { stdout, exitCode } = await runCliRaw(["export", "--redact", "--dry-run", "--dir", fixtureRoot, "--out", outDir]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("DRY RUN");
    const { readdir } = await import("fs/promises");
    expect(await readdir(outDir)).toEqual([]);
    await rm(outDir, { recursive: true, force: true });
  });
});
