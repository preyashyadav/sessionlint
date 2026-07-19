/**
 * Real ClaudeRunner implementation, wrapping `claude -p --output-format json`.
 * Unlike Phase 2's Anthropic SDK client (built blind under a network
 * blackout, marked UNVERIFIED), this was built against directly-verified
 * real behavior: ran `claude -p "say ok" --output-format json` on this
 * machine (v2.1.207) and inspected the actual JSON returned, rather than
 * trusting a research agent's claimed schema. Real fields observed:
 * type, subtype, is_error, duration_ms, num_turns, result, total_cost_usd,
 * modelUsage (keyed by model id), among others — this only reads the
 * handful sessionlint's ledger actually needs.
 *
 * Deliberately NOT covered by `bun test` — every call is a real, billed API
 * request. See run/claude-runner.smoke.md for the one-off manual
 * verification that was actually run, and don't add an automated test here
 * that would spend money on every `bun test` invocation.
 */

import type { ClaudeRunResult, ClaudeRunner } from "./types";

interface RawResultJson {
  is_error?: unknown;
  total_cost_usd?: unknown;
  num_turns?: unknown;
  duration_ms?: unknown;
  result?: unknown;
}

const KILL_GRACE_MS = 5000;

export const realClaudeRunner: ClaudeRunner = {
  async run({ prompt, model, cwd, budgetUsd, permissionMode, timeoutMs }) {
    const args = ["claude", "-p", prompt, "--model", model, "--output-format", "json", "--permission-mode", permissionMode];
    if (budgetUsd !== undefined) args.push("--max-budget-usd", String(budgetUsd));

    const proc = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" });
    const stdoutPromise = new Response(proc.stdout).text();

    if (timeoutMs !== undefined) {
      const timedOut = await Promise.race([proc.exited.then(() => false), Bun.sleep(timeoutMs).then(() => true)]);
      if (timedOut) {
        proc.kill("SIGTERM");
        const exitedGracefully = await Promise.race([proc.exited.then(() => true), Bun.sleep(KILL_GRACE_MS).then(() => false)]);
        if (!exitedGracefully) proc.kill("SIGKILL");
        await proc.exited;
        const partialStdout = await stdoutPromise;
        // Claude Code only emits its final JSON (with total_cost_usd) on graceful
        // completion — a timed-out run's real spend is genuinely unknown, not zero,
        // but there is no better number available here. resultText flags this plainly.
        return {
          isError: true,
          totalCostUsd: 0,
          numTurns: 0,
          durationMs: timeoutMs,
          resultText: `sessionlint: timed out after ${timeoutMs}ms (real cost incurred is unknown). Partial output: ${partialStdout}`,
        };
      }
    } else {
      await proc.exited;
    }

    const stdout = await stdoutPromise;
    let raw: RawResultJson;
    try {
      raw = JSON.parse(stdout) as RawResultJson;
    } catch {
      // The CLI itself failed before producing its result JSON (bad args, auth error, etc.)
      return { isError: true, totalCostUsd: 0, numTurns: 0, durationMs: 0, resultText: stdout };
    }

    return {
      isError: raw.is_error === true,
      totalCostUsd: typeof raw.total_cost_usd === "number" ? raw.total_cost_usd : 0,
      numTurns: typeof raw.num_turns === "number" ? raw.num_turns : 0,
      durationMs: typeof raw.duration_ms === "number" ? raw.duration_ms : 0,
      resultText: typeof raw.result === "string" ? raw.result : "",
    };
  },
};
