#!/usr/bin/env bun
/**
 * sessionlint CLI entry (Phase 1, LENS). Reads local Claude Code session
 * history and prints a lint report. Read-only (D-003) — never writes
 * outside its own stdout.
 *
 * Usage: sessionlint [--dir <path>] [--json | --md] [--suppress <id,id,...>] [--paranoid]
 *        sessionlint --verify [--sample-n <n>] [--yes] [--paranoid]
 *        sessionlint statusline   (reads statusLine JSON from stdin, per
 *        Claude Code's statusLine.command convention; see docs/usage-surfaces.md)
 *        sessionlint hook user-prompt-submit   (reads hook JSON from stdin;
 *        for use as a UserPromptSubmit hook command — not auto-installed,
 *        see docs/phases/PHASE-3.md Task 3)
 *        sessionlint auto-delegate <model|off> [--project-dir <path>]
 *        (writes/removes CLAUDE_CODE_SUBAGENT_MODEL in .claude/settings.local.json;
 *        takes effect next session start, not the current one — see PHASE-3.md Task 4)
 *        sessionlint budget <set <amount>|off|status>   (per-session $ budget for the
 *        credits sentinel warning ladder; checked automatically by `statusline`)
 *        Set SESSIONLINT_NO_NOTIFY=1 to suppress real OS desktop notifications.
 *        sessionlint run --prompt <text> --model-ladder <m1,m2,...> --success-check "<cmd>"
 *        [--budget <usd>] [--timeout <sec>] [--permission-mode <mode>] [--project-dir <path>]
 *        [--yes] [--paranoid] [--json]   (real, billed claude -p calls — cost preview + confirm
 *        gate; see docs/phases/PHASE-4.md Task 2. --json for CI/job-artifact consumption —
 *        see Task 6's GitHub Action)
 *        sessionlint loop [--budget <usd>] [--per-iter <usd>] [--max-iters <n>]
 *        [--poll-interval <sec>] [--project-dir <path>] -- <cmd> [args...]   (wraps any
 *        command tree without modifying it; git-commit boundaries = iterations, an
 *        ASSUMPTION not a verified convention — see docs/phases/PHASE-4.md Task 3)
 *        Add [--watchdog] [--no-progress-polls <n>] [--identical-diff-iters <n>]
 *        [--repeated-error-iters <n>] [--test-command "<cmd>"] for the convergence watchdog
 *        (no-new-commits / identical-diffs / oscillation / repeated-error — Task 4). On trip:
 *        stops the child, writes a handoff note, sends a desktop notification.
 *        Every `loop` run persists a run log (<project-dir>/.sessionlint/loop-runs/*.json).
 *        sessionlint report [<run-log-path>] [--project-dir <path>]   (the "morning-after"
 *        summary: per-iteration cost/diffstat/outcome timeline, waste breakdown, and — when
 *        the watchdog tripped — an estimated $ range saved by stopping early. Defaults to the
 *        most recent run log for --project-dir/cwd; see docs/phases/PHASE-4.md Task 5)
 *        sessionlint watch [--project-dir <path>] [--poll-interval <sec>] [--budget <usd>]
 *        [--test-pattern "<substr>"] [--notify] [--webhook <url>] [--no-progress-polls <n>]
 *        [--identical-diff-iters <n>] [--repeated-error-iters <n>] [--max-polls <n>]
 *        (Phase 5 Task 2: supervises ANY autonomous run — official ralph-loop plugin, GSD,
 *        custom in-session loops — by tailing this project's session transcripts instead of
 *        wrapping a process. Read-only by default: findings print to stdout and persist to
 *        .sessionlint/watch-state.json; it never kills anything. Same detectors as `loop`.)
 *        sessionlint install-hook [--project-dir <path>] [--hook-command "<cmd>"]  (opt-in
 *        Tier 2: writes a PreToolUse gate hook into .claude/settings.local.json so a tripped
 *        watch blocks further tool use in-session — exit-2 contract verified against the
 *        live hooks docs. Undo: sessionlint uninstall-hook)
 *        sessionlint hook-gate [--project-dir <path>] [--clear]  (the hook command itself:
 *        exits 2 with the trip reason when watch-state says tripped; --clear unblocks)
 */

import { createInterface } from "readline/promises";
import { stat } from "fs/promises";
import { discoverSessions, defaultRoot, newestTranscriptMtime } from "./src/adapters/claude-code/discover";
import { loadSession } from "./src/adapters/claude-code/session";
import { computeSessionCost } from "./src/cost/compute";
import { checkStaleness, PRICING_TABLE, STALENESS_WARNING_DAYS } from "./src/pricing";
import { ruleDocById, renderRuleDoc, renderRuleList, RULE_DOCS } from "./src/report/rule-docs";
import { buildReport } from "./src/report/build";
import { renderJson } from "./src/report/json";
import { renderMarkdown } from "./src/report/markdown";
import { renderTerminal } from "./src/report/terminal";
import { runStatusline } from "./src/pilot/statusline";
import { runUserPromptSubmitHook } from "./src/pilot/hook-user-prompt-submit";
import { runAutoDelegateOff, runAutoDelegateOn, defaultSettingsPath } from "./src/pilot/auto-delegate";
import { SettingsParseError } from "./src/pilot/delegate-config";
import { readBudgetConfig, writeBudgetConfig, clearBudgetConfig, defaultBudgetConfigPath } from "./src/pilot/budget-config";
import { runCreditsSentinelCheck } from "./src/pilot/credits-check";
import { defaultSentinelStatePath } from "./src/pilot/sentinel-state";
import { runVerify } from "./src/verify/run";
import { runCommand, renderRunResult, renderRunResultJson, realClaudeRunner, realSuccessChecker } from "./src/guard/run";
import type { RunProfile } from "./src/guard/run";
import {
  runLoop,
  renderLoopResult,
  realCostSource,
  realCommitSource,
  realDiffSource,
  realTestCommandRunner,
} from "./src/guard/loop";
import type { LoopOptions } from "./src/guard/loop";
import { loadLastRunLog, loadRunLog } from "./src/guard/report/persist";
import { renderMorningReport } from "./src/guard/report/render";
import {
  runWatch,
  clearTripState,
  installWatchHook,
  uninstallWatchHook,
  readTripState,
  defaultHookGateCommand,
  realWebhookPost,
} from "./src/guard/watch";
import type { WatchOptions } from "./src/guard/watch";
import { encodeProjectPath } from "./src/guard/loop/project-cost";
import { runExport, renderExportSummary } from "./src/export/run";
import { sendDesktopNotification } from "./src/pilot/desktop-notify";
import { join } from "path";
import { parseCommandArgv } from "./src/cli/command-argv";

/** Shared cost-preview confirm gate for any command that makes real, billed API calls
 * (--verify, run) — same contract: print the preview, --yes bypasses, a non-TTY without
 * --yes refuses rather than silently proceeding or silently hanging. */
function buildConfirmPrompt(autoYes: boolean): (previewMessage: string) => Promise<boolean> {
  return async (previewMessage: string): Promise<boolean> => {
    console.log(previewMessage);
    if (autoYes) {
      console.log("--yes passed: proceeding without an interactive prompt.");
      return true;
    }
    if (!process.stdin.isTTY) {
      console.error("Non-interactive terminal detected — pass --yes to confirm you've reviewed the cost preview above.");
      return false;
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question("Proceed with real, billed API calls? (y/N) ");
    rl.close();
    return /^y(es)?$/i.test(answer.trim());
  };
}

async function runVerifyCommand(args: string[], paranoid: boolean): Promise<void> {
  if (paranoid) {
    console.error("sessionlint --verify refused: --paranoid blocks SessionLint-owned API calls.");
    process.exit(1);
  }

  const dirIndex = args.indexOf("--dir");
  const root = dirIndex !== -1 && args[dirIndex + 1] ? args[dirIndex + 1]! : undefined;
  const nIndex = args.indexOf("--sample-n");
  const sampleN = nIndex !== -1 && args[nIndex + 1] ? Number(args[nIndex + 1]) : undefined;
  const autoYes = args.includes("--yes");

  // Real clients are imported dynamically and only here — this is the one place in the
  // codebase where an unverified module (no network access to install/typecheck it against
  // real SDK types — see src/verify/replay/anthropic-client.ts) is actually loaded.
  let AnthropicApiClient: typeof import("./src/verify/replay/anthropic-client").AnthropicApiClient;
  let AnthropicJudgeClient: typeof import("./src/verify/judge/anthropic-judge-client").AnthropicJudgeClient;
  try {
    ({ AnthropicApiClient } = await import("./src/verify/replay/anthropic-client"));
    ({ AnthropicJudgeClient } = await import("./src/verify/judge/anthropic-judge-client"));
  } catch {
    console.error(
      "sessionlint --verify needs @anthropic-ai/sdk, which isn't installed. Run `bun install` first."
    );
    process.exit(1);
  }

  const confirm = buildConfirmPrompt(autoYes);

  const result = await runVerify({
    root,
    sampleN,
    paranoid,
    apiClient: new AnthropicApiClient(),
    judgeClient: new AnthropicJudgeClient(),
    confirm,
  });

  switch (result.outcome) {
    case "no-candidates":
      console.log("No downgrade-candidate turns found in this history — nothing to verify.");
      return;
    case "declined":
      console.log("Verify cancelled — no API calls were made.");
      return;
    case "paranoid-refused":
      console.error("sessionlint --verify refused: --paranoid blocks SessionLint-owned API calls.");
      process.exit(1);
      return;
    case "completed":
      console.log(result.rendered ?? "");
      return;
  }
}

async function runStatuslineCommand(): Promise<void> {
  const raw = await new Response(Bun.stdin.stream()).text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.log("sessionlint: invalid statusline input");
    return;
  }
  console.log(await runStatusline(parsed));

  // Credits sentinel (Task 5): a no-op unless the user has set a budget via
  // `sessionlint budget set <amount>` — off by default (D-003).
  const sentinelMessages = await runCreditsSentinelCheck(parsed, { sentinelStatePath: defaultSentinelStatePath() });
  for (const message of sentinelMessages) console.log(message);
}

async function runBudgetCommand(args: string[]): Promise<void> {
  const subcommand = args[1];
  const path = defaultBudgetConfigPath();

  if (subcommand === "set") {
    const amount = args[2] ? Number(args[2]) : NaN;
    if (!Number.isFinite(amount) || amount <= 0) {
      console.error("Usage: sessionlint budget set <positive-dollar-amount>");
      process.exit(1);
    }
    await writeBudgetConfig(path, { budgetUsd: amount });
    console.log(`sessionlint: session budget set to $${amount.toFixed(2)}. Warns at 50/80/95% of this, per session.`);
    return;
  }

  if (subcommand === "off") {
    await clearBudgetConfig(path);
    console.log("sessionlint: session budget cleared — credits sentinel is off.");
    return;
  }

  if (subcommand === "status") {
    const config = await readBudgetConfig(path);
    console.log(config ? `sessionlint: session budget is $${config.budgetUsd.toFixed(2)}.` : "sessionlint: no session budget set.");
    return;
  }

  console.error("Usage: sessionlint budget <set <amount>|off|status>");
  process.exit(1);
}

async function runHookCommand(hookName: string): Promise<void> {
  const raw = await new Response(Bun.stdin.stream()).text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return; // hooks must never fail loudly; silently produce no advisory
  }
  if (hookName === "user-prompt-submit") {
    const output = await runUserPromptSubmitHook(parsed);
    if (output) console.log(output);
  }
}

async function runAutoDelegateCommand(args: string[]): Promise<void> {
  const target = args[1] && !args[1].startsWith("--") ? args[1] : undefined;
  const projectDirIndex = args.indexOf("--project-dir");
  const projectDir = projectDirIndex !== -1 && args[projectDirIndex + 1] ? args[projectDirIndex + 1]! : process.cwd();
  const settingsPath = defaultSettingsPath(projectDir);

  if (!target) {
    console.error("Usage: sessionlint auto-delegate <model|off> [--project-dir <path>]");
    process.exit(1);
  }

  try {
    if (target === "off") {
      console.log(await runAutoDelegateOff({ settingsPath }));
    } else {
      console.log(await runAutoDelegateOn(target, { settingsPath }));
    }
  } catch (err) {
    if (err instanceof SettingsParseError) {
      console.error(`sessionlint: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

async function runRunCommand(args: string[], paranoid: boolean): Promise<void> {
  if (paranoid) {
    console.error("sessionlint run refused: --paranoid blocks SessionLint-owned API calls.");
    process.exit(1);
  }

  const getFlag = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i !== -1 && args[i + 1] ? args[i + 1] : undefined;
  };

  const prompt = getFlag("--prompt");
  const modelLadderRaw = getFlag("--model-ladder");
  const successCheckRaw = getFlag("--success-check");

  if (!prompt || !modelLadderRaw || !successCheckRaw) {
    console.error(
      "Usage: sessionlint run --prompt <text> --model-ladder <m1,m2,...> --success-check \"<cmd>\" " +
        "[--budget <usd>] [--timeout <sec>] [--permission-mode <mode>] [--project-dir <path>] [--yes]"
    );
    process.exit(1);
  }

  const budgetRaw = getFlag("--budget");
  const timeoutRaw = getFlag("--timeout");
  const projectDir = getFlag("--project-dir") ?? process.cwd();
  const permissionMode = getFlag("--permission-mode") ?? "acceptEdits";
  const autoYes = args.includes("--yes");
  const asJson = args.includes("--json");

  const profile: RunProfile = {
    modelLadder: modelLadderRaw.split(",").map((m) => m.trim()).filter(Boolean),
    successCheck: parseCommandArgv(successCheckRaw, "--success-check"),
    budgetUsd: budgetRaw ? Number(budgetRaw) : undefined,
    timeoutMs: timeoutRaw ? Number(timeoutRaw) * 1000 : undefined,
    permissionMode,
  };

  const outcome = await runCommand({
    prompt,
    cwd: projectDir,
    profile,
    runner: realClaudeRunner,
    checker: realSuccessChecker,
    confirm: buildConfirmPrompt(autoYes),
  });

  if (outcome.outcome === "declined") {
    if (asJson) {
      console.log(JSON.stringify({ outcome: "declined" }, null, 2));
    } else {
      console.log("sessionlint run: cancelled — no API calls were made.");
    }
    return;
  }
  console.log(asJson ? renderRunResultJson(outcome.result) : renderRunResult(outcome.result));
  if (!outcome.result.succeeded) process.exit(1);
}

async function runLoopCommand(args: string[]): Promise<void> {
  const dashDashIndex = args.indexOf("--");
  const sessionlintArgs = dashDashIndex === -1 ? args : args.slice(0, dashDashIndex);
  const wrappedCommand = dashDashIndex === -1 ? [] : args.slice(dashDashIndex + 1);

  if (wrappedCommand.length === 0) {
    console.error(
      "Usage: sessionlint loop [--budget <usd>] [--per-iter <usd>] [--max-iters <n>] [--poll-interval <sec>] " +
        "[--project-dir <path>] [--watchdog] [--no-progress-polls <n>] [--identical-diff-iters <n>] " +
        "[--repeated-error-iters <n>] [--test-command \"<cmd>\"] -- <cmd> [args...]"
    );
    process.exit(1);
  }

  const getFlag = (name: string): string | undefined => {
    const i = sessionlintArgs.indexOf(name);
    return i !== -1 && sessionlintArgs[i + 1] ? sessionlintArgs[i + 1] : undefined;
  };

  const projectDir = getFlag("--project-dir") ?? process.cwd();
  const budgetRaw = getFlag("--budget");
  const perIterRaw = getFlag("--per-iter");
  const maxItersRaw = getFlag("--max-iters");
  const pollIntervalRaw = getFlag("--poll-interval");
  const testCommandRaw = getFlag("--test-command");

  const watchdogEnabled = sessionlintArgs.includes("--watchdog") || testCommandRaw !== undefined;
  const options: LoopOptions = {
    command: wrappedCommand,
    cwd: projectDir,
    budgetUsd: budgetRaw ? Number(budgetRaw) : undefined,
    perIterBudgetUsd: perIterRaw ? Number(perIterRaw) : undefined,
    maxIters: maxItersRaw ? Number(maxItersRaw) : undefined,
    pollIntervalMs: pollIntervalRaw ? Number(pollIntervalRaw) * 1000 : undefined,
    testCommand: testCommandRaw ? parseCommandArgv(testCommandRaw, "--test-command") : undefined,
    watchdog: watchdogEnabled
      ? {
          noProgressPolls: Number(getFlag("--no-progress-polls") ?? 10),
          identicalDiffIters: Number(getFlag("--identical-diff-iters") ?? 3),
          repeatedErrorIters: Number(getFlag("--repeated-error-iters") ?? 3),
        }
      : undefined,
  };

  const result = await runLoop(options, realCostSource, realCommitSource, realDiffSource, realTestCommandRunner);
  console.log(renderLoopResult(result));
  if (result.exitCode !== 0 && !result.stopReason) process.exit(result.exitCode ?? 1);
}

async function runReportCommand(args: string[]): Promise<void> {
  const projectDirIndex = args.indexOf("--project-dir");
  const projectDir = projectDirIndex !== -1 && args[projectDirIndex + 1] ? args[projectDirIndex + 1]! : process.cwd();
  const explicitPath = args[0] && !args[0].startsWith("--") ? args[0] : undefined;

  if (explicitPath) {
    const runLog = await loadRunLog(explicitPath);
    console.log(renderMorningReport(runLog));
    return;
  }

  const last = await loadLastRunLog(projectDir);
  if (!last) {
    console.log(`No sessionlint loop run log found for ${projectDir} — run \`sessionlint loop -- <cmd>\` first.`);
    return;
  }
  console.log(renderMorningReport(last.runLog));
}

async function runWatchCommand(args: string[], paranoid: boolean): Promise<void> {
  const getFlag = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i !== -1 && args[i + 1] ? args[i + 1] : undefined;
  };

  const projectDir = getFlag("--project-dir") ?? process.cwd();
  const pollIntervalSec = Number(getFlag("--poll-interval") ?? 5);
  const budgetRaw = getFlag("--budget");
  const maxPollsRaw = getFlag("--max-polls");
  const webhookUrl = getFlag("--webhook");
  const notify = args.includes("--notify");

  if (paranoid && webhookUrl) {
    console.error("sessionlint watch refused: --paranoid blocks SessionLint-owned webhook/API calls.");
    process.exit(1);
  }

  const options: WatchOptions = {
    sessionsDir: join(defaultRoot(), encodeProjectPath(projectDir)),
    projectDir,
    pollIntervalMs: pollIntervalSec * 1000,
    sinceMs: Date.now(),
    budgetUsd: budgetRaw ? Number(budgetRaw) : undefined,
    testPattern: getFlag("--test-pattern"),
    notify,
    webhookUrl,
    maxPolls: maxPollsRaw ? Number(maxPollsRaw) : undefined,
    watchdog: {
      // Defaults sized for in-session loops, where one legitimate turn can take minutes:
      // 120 polls x 5s = 10 quiet minutes before "no-new-commits" (here: no new turns).
      noProgressPolls: Number(getFlag("--no-progress-polls") ?? 120),
      identicalDiffIters: Number(getFlag("--identical-diff-iters") ?? 3),
      repeatedErrorIters: Number(getFlag("--repeated-error-iters") ?? 3),
    },
  };

  console.log(
    `sessionlint watch: tailing ${options.sessionsDir}\n` +
      `  read-only — findings print here and persist to ${join(projectDir, ".sessionlint", "watch-state.json")}` +
      (notify ? "\n  --notify: desktop notifications on" : "") +
      (webhookUrl ? `\n  --webhook: POSTing findings to ${webhookUrl}` : "") +
      (options.testPattern
        ? `\n  --test-pattern "${options.testPattern}": repeated-error armed`
        : "\n  (no --test-pattern: the repeated-error detector has no signal and stays off)") +
      "\n  Ctrl-C to stop."
  );

  const result = await runWatch(options, {
    onFinding: (finding) => {
      const scope = finding.sessionId ? `session ${finding.sessionId.slice(0, 8)}` : "project";
      console.log(`\n⚠ sessionlint watch [${new Date(finding.atMs).toISOString()}] ${scope}: ${finding.reason}\n  ${finding.detail}`);
      if (finding.reason !== "budget") {
        console.log("  In-session enforcement requires the opt-in hook: sessionlint install-hook");
      }
    },
    notifier: sendDesktopNotification,
    webhookPost: realWebhookPost,
  });

  console.log(
    `\nsessionlint watch: done — ${result.pollsRun} polls, ${result.sessionsSeen} session file(s), ${result.findings.length} finding(s).`
  );
}

async function runInstallHookCommand(args: string[]): Promise<void> {
  const getFlag = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i !== -1 && args[i + 1] ? args[i + 1] : undefined;
  };
  const projectDir = getFlag("--project-dir") ?? process.cwd();
  const settingsPath = defaultSettingsPath(projectDir);
  const command = getFlag("--hook-command") ?? defaultHookGateCommand(projectDir);

  const installed = await installWatchHook(settingsPath, command);
  if (!installed) {
    console.log(`sessionlint: gate hook already installed in ${settingsPath} — nothing to do.`);
    return;
  }
  console.log(
    `sessionlint: PreToolUse gate hook written to ${settingsPath}.\n` +
      `  Command: ${command}\n` +
      "  Takes effect on the NEXT Claude Code session start. When a `sessionlint watch` trip is\n" +
      "  recorded, the hook blocks further tool calls (exit 2) and tells Claude why.\n" +
      "  NOTE: until sessionlint is on PATH (npm publish pending), pass --hook-command with an\n" +
      "  absolute invocation, e.g. --hook-command \"bun run /path/to/sessionlint/index.ts hook-gate --project-dir <dir>\".\n" +
      "  Undo anytime: sessionlint uninstall-hook"
  );
}

async function runUninstallHookCommand(args: string[]): Promise<void> {
  const getFlag = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i !== -1 && args[i + 1] ? args[i + 1] : undefined;
  };
  const projectDir = getFlag("--project-dir") ?? process.cwd();
  const settingsPath = defaultSettingsPath(projectDir);
  const removed = await uninstallWatchHook(settingsPath);
  console.log(
    removed
      ? `sessionlint: gate hook removed from ${settingsPath}.`
      : `sessionlint: no gate hook found in ${settingsPath} — nothing to remove.`
  );
}

async function runHookGateCommand(args: string[]): Promise<void> {
  const getFlag = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i !== -1 && args[i + 1] ? args[i + 1] : undefined;
  };
  const projectDir = getFlag("--project-dir") ?? process.cwd();

  if (args.includes("--clear")) {
    await clearTripState(projectDir);
    console.log("sessionlint: trip state cleared — the gate is open again.");
    return;
  }

  const trip = await readTripState(projectDir);
  if (!trip) return; // gate open: exit 0, no output — this runs before EVERY tool call
  // PreToolUse contract (verified live 2026-07-16): exit 2 blocks the tool call and stderr
  // is fed back to Claude as the reason.
  console.error(
    `sessionlint watch tripped (${trip.reason}${trip.at ? ` at ${trip.at}` : ""}): ${trip.detail} — ` +
      "this loop is not converging; stop and wait for a human. A human can unblock with: sessionlint hook-gate --clear"
  );
  process.exit(2);
}

const VERSION = "0.1.0"; // keep in sync with package.json

const HELP_TEXT = `sessionlint ${VERSION} — a linter, gauge, and guard for AI coding sessions
ccusage shows the bill. sessionlint shows patterns behind it — and helps agent loops land.

AUDIT (read-only, the default)
  sessionlint                       lint your local Claude Code history; prints findings
                                    with $ cost ranges  [--dir <path>] [--json | --md]
                                    [--suppress <id,id,...>]
  sessionlint --ci                  CI gate: JSON to stdout, non-zero exit when a finding
                                    meets --fail-on <error|warning|info> (default error)
  sessionlint sessions              list discovered sessions: id, date, turns, est. cost
  sessionlint explain [<rule>]      what a rule detects, why it costs you, how to fix it
  sessionlint doctor                environment check: where sessions are read from, how
                                    many were found, pricing-table freshness
  sessionlint export --redact       write redacted copies of your sessions to a directory
                                    (prose/paths/secrets removed) so you can share history
                                    [--dir <path>] [--out <dir>]
  sessionlint --verify              replay-audit findings with real, billed API calls
                                    (asks for confirmation first)  [--sample-n <n>] [--yes]

LIVE SESSION (PILOT)
  sessionlint statusline            burn gauge for Claude Code's statusLine.command
  sessionlint budget set <usd>      per-session $ budget for the statusline sentinel
                                    (also: budget status | budget off)
  sessionlint auto-delegate <model> route subagents to a cheaper model from NEXT session
                                    (also: auto-delegate off)

AUTONOMOUS RUNS (GUARD)
  sessionlint watch                 supervise an in-session loop (ralph-loop, GSD) by
                                    tailing transcripts; read-only unless you opt in
  sessionlint loop -- <cmd>         wrap an external loop with budgets + watchdog
  sessionlint run --prompt <text>   budgeted, model-laddered headless claude -p run
  sessionlint report                morning-after summary of the last loop run
  sessionlint install-hook          opt-in PreToolUse gate: a tripped watch blocks the
                                    session's tool use (undo: uninstall-hook)

  --paranoid                        block SessionLint-owned API/webhook calls (cannot
                                    sandbox network access by child commands you launch)
  help | version | doctor           you are here

Every counterfactual $ figure is a range with labeled assumptions, never a fake-precise point.
Docs: https://github.com/preyashyadav/sessionlint`;

function runExplainCommand(args: string[]): void {
  const target = args[1];
  if (!target) {
    console.log(renderRuleList());
    return;
  }
  const doc = ruleDocById(target);
  if (!doc) {
    console.error(`Unknown rule "${target}". Known rules: ${RULE_DOCS.map((d) => d.id).join(", ")}`);
    process.exit(1);
  }
  console.log(renderRuleDoc(doc));
}

async function runDoctorCommand(): Promise<void> {
  console.log(`sessionlint ${VERSION} — environment check\n`);

  const configDir = process.env["CLAUDE_CONFIG_DIR"]?.trim();
  console.log(`  CLAUDE_CONFIG_DIR   ${configDir ?? "(not set — default ~/.claude)"}`);
  const root = defaultRoot(); // prints its own warning if a misplaced literal-~ dir is detected
  console.log(`  sessions root       ${root}`);

  try {
    const discovered = await discoverSessions(root);
    const topLevel = discovered.filter((d) => d.kind === "top-level").length;
    const subagents = discovered.length - topLevel;
    console.log(`  sessions found      ${topLevel} top-level, ${subagents} subagent transcript(s)`);
    const newest = newestTranscriptMtime(root);
    if (newest !== null) {
      const ageHours = (Date.now() - newest) / 3_600_000;
      const age = ageHours < 48 ? `${ageHours.toFixed(1)} hours ago` : `${(ageHours / 24).toFixed(1)} days ago`;
      console.log(`  newest transcript   ${age}`);
    }
    if (topLevel === 0) {
      console.log(`  ⚠ zero sessions — if you HAVE run Claude Code, its data is going somewhere`);
      console.log(`    else (wrong CLAUDE_CONFIG_DIR? see the warning above if one printed)`);
    }
  } catch (err) {
    console.log(`  ⚠ cannot read root  ${err instanceof Error ? err.message : String(err)}`);
  }

  const staleness = checkStaleness();
  const staleNote = staleness.stale
    ? `⚠ STALE (over ${STALENESS_WARNING_DAYS} days — $ figures may drift from current prices)`
    : "fresh";
  console.log(`  pricing table       retrieved ${PRICING_TABLE.retrievedAt}, ${staleness.daysSince} day(s) old — ${staleNote}`);
}

async function runExportCommand(args: string[]): Promise<void> {
  // --redact is mandatory: there is no raw export, so a user can never accidentally
  // write un-redacted transcripts to a shareable directory.
  if (!args.includes("--redact")) {
    console.error(
      "sessionlint export requires --redact (there is no raw export).\n" +
        "Usage: sessionlint export --redact [--dir <path>] [--out <dir>]"
    );
    process.exit(2);
  }
  const dirIndex = args.indexOf("--dir");
  const root = dirIndex !== -1 && args[dirIndex + 1] ? args[dirIndex + 1]! : undefined;
  const outIndex = args.indexOf("--out");
  const outDir = outIndex !== -1 && args[outIndex + 1] ? args[outIndex + 1]! : "sessionlint-export";

  const summary = await runExport({ root, outDir });
  console.log(renderExportSummary(summary));
}

async function runSessionsCommand(args: string[]): Promise<void> {
  const dirIndex = args.indexOf("--dir");
  const root = dirIndex !== -1 && args[dirIndex + 1] ? args[dirIndex + 1]! : defaultRoot();

  const discovered = (await discoverSessions(root)).filter((d) => d.kind === "top-level");
  if (discovered.length === 0) {
    console.log("No session files found. Run Claude Code at least once to generate logs.");
    return;
  }

  const asOf = new Date();
  const rows: Array<{ id: string; date: Date; turns: number; cost: number; title: string }> = [];
  for (const d of discovered) {
    const loaded = await loadSession(d.filePath, d.sessionId);
    const fileStat = await stat(d.filePath).catch(() => null);
    let title = "";
    for (const turn of loaded.session.turns) {
      for (const entry of turn.entries) {
        const raw = entry.raw as { type?: unknown; aiTitle?: unknown };
        if (raw.type === "ai-title" && typeof raw.aiTitle === "string") title = raw.aiTitle;
      }
    }
    rows.push({
      id: (loaded.session.sessionId ?? "unknown").slice(0, 8),
      date: fileStat ? fileStat.mtime : new Date(0),
      turns: loaded.session.turns.length,
      cost: computeSessionCost(loaded.session, asOf).totalCost,
      title,
    });
  }
  rows.sort((a, b) => b.date.getTime() - a.date.getTime());

  console.log(`sessionlint · ${rows.length} session(s) in ${root}\n`);
  console.log(`  ${"session".padEnd(9)} ${"last active".padEnd(12)} ${"turns".padStart(5)}  ${"est. cost".padStart(9)}  title`);
  for (const r of rows) {
    const date = r.date.getTime() === 0 ? "—" : r.date.toISOString().slice(0, 10);
    const title = r.title.length > 44 ? `${r.title.slice(0, 43)}…` : r.title;
    console.log(`  ${r.id.padEnd(9)} ${date.padEnd(12)} ${String(r.turns).padStart(5)}  ${("$" + r.cost.toFixed(2)).padStart(9)}  ${title}`);
  }
  console.log(`\n  Costs are API-equivalent estimates, not subscription billing. Run \`sessionlint\` for findings.`);
}

const KNOWN_SUBCOMMANDS = new Set([
  "statusline", "hook", "auto-delegate", "budget", "run", "loop", "report", "watch",
  "install-hook", "uninstall-hook", "hook-gate", "explain", "doctor", "sessions",
  "export", "help", "version",
]);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const paranoid = args.includes("--paranoid");

  if (args[0] === "help" || args.includes("--help") || args.includes("-h")) {
    console.log(HELP_TEXT);
    return;
  }

  if (args[0] === "version" || args.includes("--version")) {
    console.log(`${VERSION} (sessionlint)`);
    return;
  }

  if (args[0] === "explain") {
    runExplainCommand(args);
    return;
  }

  if (args[0] === "doctor") {
    await runDoctorCommand();
    return;
  }

  if (args[0] === "sessions") {
    await runSessionsCommand(args);
    return;
  }

  if (args[0] === "export") {
    await runExportCommand(args.slice(1));
    return;
  }

  // A non-flag first arg that isn't a known subcommand is a typo, not a request to
  // lint — silently running LENS here is how stray words get ignored (a real user
  // pasted "sessionlint --verify to replay-audit" and the junk args vanished).
  if (args[0] && !args[0].startsWith("-") && !KNOWN_SUBCOMMANDS.has(args[0])) {
    console.error(`Unknown command "${args[0]}". Run \`sessionlint help\` for usage.`);
    process.exit(1);
  }

  if (args[0] === "statusline") {
    await runStatuslineCommand();
    return;
  }

  if (args[0] === "hook") {
    await runHookCommand(args[1] ?? "");
    return;
  }

  if (args[0] === "auto-delegate") {
    await runAutoDelegateCommand(args);
    return;
  }

  if (args[0] === "budget") {
    await runBudgetCommand(args);
    return;
  }

  if (args[0] === "run") {
    await runRunCommand(args, paranoid);
    return;
  }

  if (args[0] === "loop") {
    await runLoopCommand(args.slice(1));
    return;
  }

  if (args[0] === "report") {
    await runReportCommand(args.slice(1));
    return;
  }

  if (args[0] === "watch") {
    await runWatchCommand(args.slice(1), paranoid);
    return;
  }

  if (args[0] === "install-hook") {
    await runInstallHookCommand(args.slice(1));
    return;
  }

  if (args[0] === "uninstall-hook") {
    await runUninstallHookCommand(args.slice(1));
    return;
  }

  if (args[0] === "hook-gate") {
    await runHookGateCommand(args.slice(1));
    return;
  }

  if (args.includes("--verify")) {
    await runVerifyCommand(args, paranoid);
    return;
  }

  const dirIndex = args.indexOf("--dir");
  const root = dirIndex !== -1 && args[dirIndex + 1] ? args[dirIndex + 1]! : defaultRoot();

  const suppressIndex = args.indexOf("--suppress");
  const suppressedRuleIds =
    suppressIndex !== -1 && args[suppressIndex + 1]
      ? args[suppressIndex + 1]!
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  const discovered = (await discoverSessions(root)).filter((d) => d.kind === "top-level");
  if (discovered.length === 0) {
    console.log("No session files found. Run Claude Code at least once to generate logs.");
    return;
  }

  const loaded = [];
  for (const d of discovered) {
    loaded.push(await loadSession(d.filePath, d.sessionId));
  }

  const report = buildReport(loaded, { suppressedRuleIds });

  if (args.includes("--ci")) {
    runCiGate(report, args);
    return;
  }

  if (args.includes("--json")) {
    console.log(renderJson(report));
  } else if (args.includes("--md")) {
    console.log(renderMarkdown(report));
  } else {
    console.log(renderTerminal(report));
  }
}

/** `--ci`: machine-readable output (JSON by default, --md respected) plus a non-zero exit when a
 * finding meets the `--fail-on` severity threshold (default "error"). No TTY assumptions. */
function runCiGate(report: import("./src/report/types").Report, args: string[]): void {
  const SEVERITY_RANK: Record<string, number> = { info: 0, warning: 1, error: 2 };
  const failIdx = args.indexOf("--fail-on");
  const failOn = failIdx !== -1 && args[failIdx + 1] ? args[failIdx + 1]! : "error";
  if (!(failOn in SEVERITY_RANK)) {
    console.error(`--fail-on must be one of: info, warning, error (got "${failOn}")`);
    process.exit(2);
  }
  const threshold = SEVERITY_RANK[failOn]!;

  console.log(args.includes("--md") ? renderMarkdown(report) : renderJson(report));

  const worst = report.flaggedSessions
    .flatMap((s) => s.findings)
    .reduce((max, f) => Math.max(max, SEVERITY_RANK[f.severity] ?? 0), -1);
  if (worst >= threshold) process.exitCode = 1;
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    // A clean, actionable message by default (found via a real cold-start smoke test:
    // console.error(err) prints a full stack trace + source code frame, which is
    // startling for an expected, anticipated failure like "directory not found").
    // Set SESSIONLINT_DEBUG=1 to see the full error for genuinely unexpected bugs.
    if (process.env["SESSIONLINT_DEBUG"]) {
      console.error("sessionlint error:", err);
    } else {
      console.error(`sessionlint error: ${err instanceof Error ? err.message : String(err)}`);
    }
    process.exit(1);
  });
}
