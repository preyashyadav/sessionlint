import type { Entry, Turn } from "../adapters/claude-code/types";

/**
 * One turn can span many internal API calls (one per tool round-trip); each
 * call's usage fields already describe the FULL context at that moment, not
 * an incremental delta. Summing across a turn's UsageTotals (as Task 2's cost
 * engine correctly does, since you're billed per call) wildly overcounts
 * "current context size" — found by running the CLI against real history,
 * where a multi-call turn reported ~9.26M context tokens. These helpers read
 * a single call's raw usage bag instead.
 */
function usageBagsOf(turn: Turn): Record<string, unknown>[] {
  const bags: Record<string, unknown>[] = [];
  for (const entry of turn.entries) {
    if (entry.kind !== "assistant-message" && entry.kind !== "assistant-error") continue;
    const usage = (entry.raw as { message?: { usage?: Record<string, unknown> } }).message?.usage;
    if (usage) bags.push(usage);
  }
  return bags;
}

function numberField(bag: Record<string, unknown>, key: string): number {
  const v = bag[key];
  return typeof v === "number" ? v : 0;
}

function bagContextSize(bag: Record<string, unknown>): number {
  return numberField(bag, "input_tokens") + numberField(bag, "cache_read_input_tokens") + numberField(bag, "cache_creation_input_tokens");
}

/** Context size as of a turn's LAST API call — the most complete single-call snapshot. */
export function turnContextSize(turn: Turn): number {
  const bags = usageBagsOf(turn);
  const last = bags[bags.length - 1];
  return last ? bagContextSize(last) : 0;
}

/** Fresh (uncached) input tokens on a turn's FIRST API call — what actually paid full price with no cache. */
export function firstCallInputTokens(turn: Turn): number {
  const bags = usageBagsOf(turn);
  const first = bags[0];
  return first ? numberField(first, "input_tokens") : 0;
}

/** True if `entry` is a compaction-boundary system entry (carries compactMetadata). */
export function isCompactionEntry(entry: Entry): boolean {
  const raw = entry.raw as { type?: unknown; compactMetadata?: unknown };
  return raw.type === "system" && raw.compactMetadata !== null && typeof raw.compactMetadata === "object";
}

/**
 * Text the HARNESS injects into a user turn — not something the human typed.
 * Claude Code wraps slash-command output (`/model`, `/clear`, ...) in
 * <local-command-*> / <command-*> blocks and injects <system-reminder> blocks,
 * all of which land in `message.content` looking exactly like a user message.
 *
 * Two identical harness blocks in a row are the harness being consistent, not a
 * human retrying — repeated-identical-prompt fired on a real `/model` echo before
 * this filter existed. Compaction summaries are already excluded upstream by the
 * "meta" entry classification; this is the same idea for slash-command echoes.
 */
const HARNESS_BLOCK_PREFIXES = [
  "<local-command-caveat>",
  "<local-command-stdout>",
  "<local-command-stderr>",
  "<command-name>",
  "<command-message>",
  "<command-args>",
  "<system-reminder>",
] as const;

export function isHarnessInjectedText(text: string): boolean {
  const t = text.trimStart();
  return HARNESS_BLOCK_PREFIXES.some((p) => t.startsWith(p));
}

/**
 * Extracts the human-authored prompt text from a turn's first real user message, if any.
 * Harness-injected blocks are skipped — they are not human-authored input.
 */
export function extractPromptText(turn: Turn): string | null {
  for (const entry of turn.entries) {
    if (entry.kind !== "user-message") continue;
    const raw = entry.raw as { message?: { content?: unknown } };
    const content = raw.message?.content;
    if (typeof content === "string" && content.length > 0) {
      const t = content.trim();
      if (!isHarnessInjectedText(t)) return t;
      continue;
    }
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block && typeof block === "object" && (block as { type?: unknown }).type === "text") {
          const text = (block as { text?: unknown }).text;
          if (typeof text === "string" && text.length > 0) {
            const t = text.trim();
            if (!isHarnessInjectedText(t)) return t;
          }
        }
      }
    }
  }
  return null;
}

/** Every text block across every entry in a turn — both human and assistant text, for
 * scans that must see the whole turn (e.g. secret-pattern exclusion), not just the prompt. */
export function extractAllTurnText(turn: Turn): string {
  const parts: string[] = [];
  for (const entry of turn.entries) {
    const raw = entry.raw as { message?: { content?: unknown } };
    const content = raw.message?.content;
    if (typeof content === "string") {
      parts.push(content);
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block && typeof block === "object" && (block as { type?: unknown }).type === "text") {
          const text = (block as { text?: unknown }).text;
          if (typeof text === "string") parts.push(text);
        }
      }
    }
  }
  return parts.join("\n");
}

/** Just the assistant's own text response(s) in a turn — for comparing the original
 * response against a replayed one (Phase 2's judge pipeline), not the human prompt. */
export function extractAssistantText(turn: Turn): string {
  const parts: string[] = [];
  for (const entry of turn.entries) {
    if (entry.kind !== "assistant-message") continue;
    const raw = entry.raw as { message?: { content?: unknown } };
    const content = raw.message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block && typeof block === "object" && (block as { type?: unknown }).type === "text") {
          const text = (block as { text?: unknown }).text;
          if (typeof text === "string") parts.push(text);
        }
      }
    }
  }
  return parts.join("\n");
}
