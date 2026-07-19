/**
 * Phase 4 Task 2 (`sessionlint run`) domain types. Field names in
 * ClaudeRunResult mirror `claude -p --output-format json`'s real schema,
 * independently verified against the actual installed binary (v2.1.207) —
 * not taken on a research agent's word alone (which also included at least
 * one fabricated flag, `--max-turns`, that doesn't actually exist).
 */

export interface ClaudeRunResult {
  /** CLI-level failure (bad args, auth error, etc.) — NOT the same as the agentic
   * task failing; Claude Code only self-reports success at the CLI level. */
  isError: boolean;
  totalCostUsd: number;
  numTurns: number;
  durationMs: number;
  resultText: string;
}

export interface ClaudeRunner {
  run(args: {
    prompt: string;
    model: string;
    cwd: string;
    budgetUsd?: number;
    permissionMode: string;
    timeoutMs?: number;
  }): Promise<ClaudeRunResult>;
}

export interface SuccessChecker {
  check(args: { command: string[]; cwd: string }): Promise<{ exitCode: number | null }>;
}

export interface RunProfile {
  /** Tried in order; the first model whose success check passes wins. */
  modelLadder: string[];
  /** e.g. ["npm", "test"] — task-level success is defined by THIS command's exit
   * code, never by Claude's own self-reported result (which is CLI-level only). */
  successCheck: string[];
  /** Per-rung budget cap, passed through to `claude -p --max-budget-usd`. */
  budgetUsd?: number;
  permissionMode: string;
  /** Wall-clock cap per rung. A timed-out rung's real cost is UNKNOWN — Claude Code only
   * reports total_cost_usd in its final JSON, which is never emitted if killed mid-run. */
  timeoutMs?: number;
}

export interface LadderRungResult {
  model: string;
  costUsd: number;
  isError: boolean;
  successCheckExitCode: number | null;
  succeeded: boolean;
  durationMs: number;
}

export interface RunResult {
  succeeded: boolean;
  rungs: LadderRungResult[];
  totalCostUsd: number;
}
