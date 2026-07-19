/**
 * Phase 5 Task 2: transcript-native iteration signals. Produces the SAME
 * IterationRecord shape the Phase 4 watchdog detectors already consume — one
 * detector codebase (evaluateWatchdog), two signal sources: the legacy loop
 * wrapper keeps its git-commit signals (with its documented ASSUMPTION), and
 * watch mode builds records straight from the session transcript.
 *
 * Every signal here was verified against real ~/.claude/projects JSONL on
 * 2026-07-16 before being built on (MASTER.md discipline), not assumed:
 *   - Iteration boundary = a turn (promptId group) — verified Phase 1.
 *   - Edit signal: assistant tool_use blocks carry input {file_path,
 *     old_string, new_string, replace_all} (Edit) / {file_path, content}
 *     (Write) — the transcript-native equivalent of a git diff.
 *   - Test signal: Bash tool results carry NO exit-code field; the real
 *     failure signal is `is_error: true` on the tool_result block, whose
 *     string content starts "Exit code N" for a failing command (48 real
 *     failures confirmed the shape). Harness rejections also set is_error;
 *     signature comparison distinguishes them, and unattended loops have no
 *     interactive rejections anyway.
 */

import { buildTestOutputSignature } from "../watchdog/real-diff-source";
import type { Session, Turn } from "../../adapters/claude-code/types";
import type { IterationRecord } from "../watchdog/types";

export interface TranscriptSignalOptions {
  /** Substring marking a Bash tool_use as "the test run" (e.g. "bun test"). Without it,
   * repeated-error has no transcript-native signal and never trips — documented, not guessed. */
  testPattern?: string;
}

const EDIT_TOOL_NAMES = new Set(["Edit", "Write", "NotebookEdit"]);

interface ContentBlock {
  type?: unknown;
  name?: unknown;
  id?: unknown;
  input?: unknown;
  tool_use_id?: unknown;
  is_error?: unknown;
  content?: unknown;
}

function contentBlocksOf(turn: Turn): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const entry of turn.entries) {
    const content = (entry.raw as { message?: { content?: unknown } }).message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block && typeof block === "object") blocks.push(block as ContentBlock);
    }
  }
  return blocks;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Text of a tool_result's content — string form and text-block-array form both occur. */
function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === "object" && (b as { type?: unknown }).type === "text" ? str((b as { text?: unknown }).text) : ""))
      .join("\n");
  }
  return "";
}

/** The transcript-native "diff": every file-mutating tool_use in the turn, in order.
 * Empty string when the turn made no edits — same contract as git diffText (detectors
 * deliberately don't count empty diffs as "identical"). */
export function turnEditSignature(turn: Turn): string {
  const parts: string[] = [];
  for (const block of contentBlocksOf(turn)) {
    if (block.type !== "tool_use" || !EDIT_TOOL_NAMES.has(str(block.name))) continue;
    const input = (block.input ?? {}) as Record<string, unknown>;
    const filePath = str(input["file_path"]) || str(input["notebook_path"]);
    if (str(block.name) === "Edit") {
      const replaceAll = input["replace_all"] === true ? " replace_all" : "";
      parts.push(`Edit ${filePath}${replaceAll}\n<<<${str(input["old_string"])}>>>${str(input["new_string"])}`);
    } else if (str(block.name) === "Write") {
      parts.push(`Write ${filePath}\n${str(input["content"])}`);
    } else {
      parts.push(`NotebookEdit ${filePath}\n${JSON.stringify(input)}`);
    }
  }
  return parts.join("\n---\n");
}

export interface TurnTestSignal {
  exitCode: number | null;
  outputSignature: string | null;
}

/** Result of the LAST Bash tool_use in the turn whose command contains `testPattern`.
 * Exit code: 0 for a clean result; for is_error results, the leading "Exit code N" is
 * parsed from the content (verified real shape), falling back to 1 when absent. */
export function turnTestSignal(turn: Turn, testPattern: string | undefined): TurnTestSignal {
  if (!testPattern) return { exitCode: null, outputSignature: null };

  const blocks = contentBlocksOf(turn);
  const testUseIds = new Set<string>();
  for (const block of blocks) {
    if (block.type !== "tool_use" || str(block.name) !== "Bash") continue;
    const command = str((block.input as Record<string, unknown> | undefined)?.["command"]);
    if (command.includes(testPattern) && typeof block.id === "string") testUseIds.add(block.id);
  }
  if (testUseIds.size === 0) return { exitCode: null, outputSignature: null };

  let result: TurnTestSignal = { exitCode: null, outputSignature: null };
  for (const block of blocks) {
    if (block.type !== "tool_result" || !testUseIds.has(str(block.tool_use_id))) continue;
    const text = toolResultText(block.content);
    if (block.is_error === true) {
      const match = /^Exit code (\d+)/.exec(text);
      result = { exitCode: match ? Number(match[1]) : 1, outputSignature: buildTestOutputSignature(text) };
    } else {
      result = { exitCode: 0, outputSignature: buildTestOutputSignature(text) };
    }
  }
  return result;
}

/** One IterationRecord per turn — the transcript-native equivalent of one commit. */
export function turnIterationRecord(turn: Turn, options: TranscriptSignalOptions): IterationRecord {
  const test = turnTestSignal(turn, options.testPattern);
  return {
    commit: turn.turnId,
    diffText: turnEditSignature(turn),
    testExitCode: test.exitCode,
    testOutputSignature: test.outputSignature,
  };
}

/** Records for every turn that started at/after `sinceMs` (null = all turns) — watch mode
 * must not judge history that predates the watch (an old stall in the same file is not
 * this run's stall). Turns without a timestamp are skipped when filtering. */
export function sessionIterationRecords(
  session: Session,
  sinceMs: number | null,
  options: TranscriptSignalOptions
): IterationRecord[] {
  const records: IterationRecord[] = [];
  for (const turn of session.turns) {
    if (sinceMs !== null && (!turn.startedAt || turn.startedAt.getTime() < sinceMs)) continue;
    records.push(turnIterationRecord(turn, options));
  }
  return records;
}
