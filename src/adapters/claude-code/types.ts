/**
 * Reconstructed domain model for a Claude Code session — what parse.ts +
 * turns.ts build from RawEntry lines, and what everything downstream
 * (cost engine, cache-nuke detector, rules, report) consumes.
 */

import type { RawEntry } from "./schema";

export type EntryKind =
  | "user-message"
  | "tool-result"
  | "assistant-message"
  | "assistant-error"
  | "meta"
  | "unknown";

export interface Entry {
  raw: RawEntry;
  lineNumber: number;
  uuid: string | null;
  parentUuid: string | null;
  timestamp: Date | null;
  kind: EntryKind;
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  /** Per-assistant-entry raw usage bags, untouched — Task 2 (cost engine) owns pricing-field interpretation. */
  raw: Record<string, unknown>[];
}

export interface ContentSummary {
  hasText: boolean;
  toolUseNames: string[];
  toolResultCount: number;
}

export type TurnIdSource = "prompt-id" | "parent-chain-fallback";

export interface Turn {
  turnId: string;
  turnIdSource: TurnIdSource;
  startedAt: Date | null;
  entries: Entry[];
  /** Resolved, validated model for this turn (null if none valid). */
  model: string | null;
  /** Raw model value even if invalid — for evidence lines. */
  modelRaw: string | null;
  modelValid: boolean;
  usage: UsageTotals | null;
  content: ContentSummary;
}

export interface ModelSwitchEvent {
  fromModel: string;
  toModel: string;
  atTurnId: string;
  atTimestamp: Date | null;
}

export interface Session {
  sessionId: string;
  filePath: string;
  ccVersions: string[];
  turns: Turn[];
  modelSwitches: ModelSwitchEvent[];
  entryCount: number;
  unknownTypeCounts: Record<string, number>;
  parseErrorCount: number;
}
