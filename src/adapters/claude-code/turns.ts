/**
 * Turn / session / model-switch reconstruction.
 *
 * Turn key = `promptId`, resolved via nearest ancestor. Verified directly
 * against the real fixture corpus: `promptId` is stamped on `user`-type
 * entries (both the real human message and every `tool_result`-echo `user`
 * entry that follows it) but NEVER on `assistant` entries — an assistant
 * entry must resolve its turn by walking `parentUuid` up to the nearest
 * ancestor that has a `promptId`. One human message can produce dozens of
 * tool round-trips before yielding back — a turn is that whole cycle, not
 * one JSONL line.
 *
 * Fallback (rare — not observed in any real fixture): an entry whose
 * ancestor walk hits a dead end with no `promptId` anywhere synthesizes
 * turn boundaries at every entry with real human-authored text instead.
 */

import { isValidModelShape } from "./model";
import type { RawEntry } from "./schema";
import type {
  ContentSummary,
  Entry,
  EntryKind,
  ModelSwitchEvent,
  Session,
  Turn,
  TurnIdSource,
  UsageTotals,
} from "./types";

const KNOWN_META_TYPES = new Set([
  "ai-title",
  "last-prompt",
  "attachment",
  "file-history-snapshot",
  "queue-operation",
  "mode",
  "system", // includes compaction-boundary entries carrying compactMetadata
]);

function toDate(raw: unknown): Date | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function hasTextBlock(content: unknown): boolean {
  if (typeof content === "string") return content.length > 0;
  if (Array.isArray(content)) {
    return content.some(
      (b) => b && typeof b === "object" && (b as { type?: unknown }).type === "text" &&
        typeof (b as { text?: unknown }).text === "string" && (b as { text: string }).text.length > 0
    );
  }
  return false;
}

function isToolResultOnly(content: unknown): boolean {
  if (!Array.isArray(content) || content.length === 0) return false;
  return content.every((b) => b && typeof b === "object" && (b as { type?: unknown }).type === "tool_result");
}

function classifyEntryKind(raw: RawEntry): EntryKind {
  if (raw.type === "assistant") {
    const isError =
      (raw as { isApiErrorMessage?: unknown }).isApiErrorMessage === true ||
      (typeof (raw as { error?: unknown }).error === "string" && (raw as { error: string }).error.length > 0);
    return isError ? "assistant-error" : "assistant-message";
  }
  if (raw.type === "user") {
    // A server-generated post-compaction summary reads as real prose (it starts "This
    // session is being continued...") but is not a human-authored prompt — treating it
    // as a fresh turn-boundary would fabricate a "user message" that was never typed.
    if ((raw as { isCompactSummary?: unknown }).isCompactSummary === true) return "meta";
    const content = (raw as { message?: { content?: unknown } }).message?.content;
    if (isToolResultOnly(content)) return "tool-result";
    if (hasTextBlock(content)) return "user-message";
    return "meta";
  }
  if (KNOWN_META_TYPES.has(raw.type)) return "meta";
  return "unknown";
}

function toEntry(raw: RawEntry, lineNumber: number): Entry {
  return {
    raw,
    lineNumber,
    uuid: typeof raw.uuid === "string" ? raw.uuid : null,
    parentUuid: typeof raw.parentUuid === "string" ? raw.parentUuid : null,
    timestamp: toDate(raw.timestamp),
    kind: classifyEntryKind(raw),
  };
}

/** Resolves an entry's turn id: its own promptId, or the nearest ancestor's. Cycle-safe, memoized. */
function resolveTurnId(
  entry: Entry,
  byUuid: Map<string, Entry>,
  memo: Map<string, string | null>
): string | null {
  const ownPromptId = entry.raw.promptId;
  if (typeof ownPromptId === "string" && ownPromptId.length > 0) return ownPromptId;

  if (entry.uuid && memo.has(entry.uuid)) return memo.get(entry.uuid) ?? null;

  const visiting = new Set<string>();
  let current: Entry | undefined = entry;
  const chain: Entry[] = [];

  while (current) {
    const pid = current.raw.promptId;
    if (typeof pid === "string" && pid.length > 0) {
      for (const e of chain) if (e.uuid) memo.set(e.uuid, pid);
      if (entry.uuid) memo.set(entry.uuid, pid);
      return pid;
    }
    if (current.uuid) {
      if (visiting.has(current.uuid)) break; // cycle — bail to fallback
      visiting.add(current.uuid);
      const cached = memo.get(current.uuid);
      if (cached !== undefined) {
        for (const e of chain) if (e.uuid) memo.set(e.uuid, cached);
        return cached;
      }
    }
    chain.push(current);
    current = current.parentUuid ? byUuid.get(current.parentUuid) : undefined;
  }

  for (const e of chain) if (e.uuid) memo.set(e.uuid, null);
  return null;
}

function buildContentSummary(entries: Entry[]): ContentSummary {
  let hasText = false;
  const toolUseNames: string[] = [];
  let toolResultCount = 0;

  for (const e of entries) {
    const raw = e.raw as { message?: { content?: unknown } };
    const content = raw.message?.content;
    if (hasTextBlock(content)) hasText = true;
    if (Array.isArray(content)) {
      for (const b of content) {
        if (b && typeof b === "object") {
          const block = b as { type?: unknown; name?: unknown };
          if (block.type === "tool_use" && typeof block.name === "string") toolUseNames.push(block.name);
          if (block.type === "tool_result") toolResultCount++;
        }
      }
    }
  }

  return { hasText, toolUseNames, toolResultCount };
}

function buildUsage(entries: Entry[]): UsageTotals | null {
  const bags: Record<string, unknown>[] = [];
  for (const e of entries) {
    if (e.kind !== "assistant-message" && e.kind !== "assistant-error") continue;
    const usage = (e.raw as { message?: { usage?: Record<string, unknown> } }).message?.usage;
    if (usage) bags.push(usage);
  }
  if (bags.length === 0) return null;

  const sum = (key: string) => bags.reduce((acc, b) => acc + (typeof b[key] === "number" ? (b[key] as number) : 0), 0);
  return {
    inputTokens: sum("input_tokens"),
    outputTokens: sum("output_tokens"),
    cacheCreationInputTokens: sum("cache_creation_input_tokens"),
    cacheReadInputTokens: sum("cache_read_input_tokens"),
    raw: bags,
  };
}

/** Turn model = last assistant entry's model (message or error) in the turn — reflects what most recently produced output. */
function resolveTurnModel(entries: Entry[]): { model: string | null; modelRaw: string | null; modelValid: boolean } {
  let modelRaw: string | null = null;
  for (const e of entries) {
    if (e.kind !== "assistant-message" && e.kind !== "assistant-error") continue;
    const m = (e.raw as { message?: { model?: unknown } }).message?.model;
    modelRaw = typeof m === "string" ? m : null;
  }
  const valid = isValidModelShape(modelRaw);
  return { model: valid ? modelRaw : null, modelRaw, modelValid: valid };
}

function sortByTimestamp<T extends { timestamp: Date | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const at = a.timestamp?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bt = b.timestamp?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return at - bt;
  });
}

function sortTurnsByStart(turns: Turn[]): Turn[] {
  return [...turns].sort((a, b) => {
    const at = a.startedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bt = b.startedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return at - bt;
  });
}

function buildTurn(turnId: string, turnIdSource: TurnIdSource, rawEntries: Entry[]): Turn {
  const entries = sortByTimestamp(rawEntries);
  const startedAt = entries.reduce<Date | null>((min, e) => {
    if (!e.timestamp) return min;
    if (!min || e.timestamp < min) return e.timestamp;
    return min;
  }, null);
  const { model, modelRaw, modelValid } = resolveTurnModel(entries);

  return {
    turnId,
    turnIdSource,
    startedAt,
    entries,
    model,
    modelRaw,
    modelValid,
    usage: buildUsage(entries),
    content: buildContentSummary(entries),
  };
}

function groupIntoTurns(entries: Entry[]): { turns: Turn[]; usedFallback: boolean } {
  const byUuid = new Map<string, Entry>();
  for (const e of entries) if (e.uuid) byUuid.set(e.uuid, e);

  const memo = new Map<string, string | null>();
  const groups = new Map<string, Entry[]>();
  const unresolved: Entry[] = [];

  for (const e of entries) {
    const turnId = resolveTurnId(e, byUuid, memo);
    if (turnId === null) {
      unresolved.push(e);
      continue;
    }
    const bucket = groups.get(turnId);
    if (bucket) bucket.push(e);
    else groups.set(turnId, [e]);
  }

  const turns: Turn[] = [];
  for (const [turnId, groupEntries] of groups) {
    turns.push(buildTurn(turnId, "prompt-id", groupEntries));
  }

  const usedFallback = unresolved.length > 0;
  if (usedFallback) {
    const ordered = sortByTimestamp(unresolved);
    let syntheticIndex = 0;
    let current: Entry[] = [];
    const flush = () => {
      if (current.length === 0) return;
      turns.push(buildTurn(`turn-synthetic-${syntheticIndex++}`, "parent-chain-fallback", current));
      current = [];
    };
    for (const e of ordered) {
      if (e.kind === "user-message" && current.length > 0) flush();
      current.push(e);
    }
    flush();
  }

  return { turns: sortTurnsByStart(turns), usedFallback };
}

function buildModelSwitches(turns: Turn[]): ModelSwitchEvent[] {
  const switches: ModelSwitchEvent[] = [];
  let previous: { model: string; turnId: string } | null = null;

  for (const turn of turns) {
    if (!turn.modelValid || !turn.model) continue;
    if (previous && previous.model !== turn.model) {
      switches.push({
        fromModel: previous.model,
        toModel: turn.model,
        atTurnId: turn.turnId,
        atTimestamp: turn.startedAt,
      });
    }
    previous = { model: turn.model, turnId: turn.turnId };
  }

  return switches;
}

export interface BuildSessionInput {
  filePath: string;
  sessionIdHint: string | null;
  rawEntries: { lineNumber: number; raw: RawEntry }[];
  parseErrorCount: number;
}

export interface BuildSessionResult {
  session: Session;
  usedTurnGroupingFallback: boolean;
  invalidModelCount: number;
}

export function buildSession(input: BuildSessionInput): BuildSessionResult {
  const entries = input.rawEntries.map(({ lineNumber, raw }) => toEntry(raw, lineNumber));

  const ccVersions = [...new Set(entries.map((e) => e.raw.version).filter((v): v is string => typeof v === "string"))];
  const unknownTypeCounts: Record<string, number> = {};
  let invalidModelCount = 0;

  for (const e of entries) {
    if (e.kind === "unknown") {
      unknownTypeCounts[e.raw.type] = (unknownTypeCounts[e.raw.type] ?? 0) + 1;
    }
    if (e.kind === "assistant-message" || e.kind === "assistant-error") {
      const m = (e.raw as { message?: { model?: unknown } }).message?.model;
      if (typeof m === "string" && !isValidModelShape(m)) invalidModelCount++;
    }
  }

  const { turns: finalTurns, usedFallback } = groupIntoTurns(entries);

  const sessionId =
    entries.find((e) => typeof e.raw.sessionId === "string")?.raw.sessionId ?? input.sessionIdHint ?? "unknown";

  const session: Session = {
    sessionId,
    filePath: input.filePath,
    ccVersions,
    turns: finalTurns,
    modelSwitches: buildModelSwitches(finalTurns),
    entryCount: entries.length,
    unknownTypeCounts,
    parseErrorCount: input.parseErrorCount,
  };

  return { session, usedTurnGroupingFallback: usedFallback, invalidModelCount };
}
