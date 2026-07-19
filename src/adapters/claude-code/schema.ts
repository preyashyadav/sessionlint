/**
 * Raw Claude Code JSONL entry shapes, as they appear on disk. Deliberately
 * loose: `type` is `string` (not a closed union) and every interface allows
 * unknown extra fields, so a future CC schema change is tolerated rather
 * than rejected by the type system.
 */

export interface RawContentBlock {
  type: string;
  [key: string]: unknown;
}

export interface RawEntryBase {
  type: string;
  sessionId?: string;
  version?: string;
  timestamp?: string;
  uuid?: string;
  parentUuid?: string | null;
  promptId?: string;
  isSidechain?: boolean;
  [key: string]: unknown;
}

export interface RawAssistantEntry extends RawEntryBase {
  type: "assistant";
  message?: {
    model?: string;
    role?: string;
    content?: RawContentBlock[];
    usage?: Record<string, unknown>;
    stop_reason?: string | null;
    [key: string]: unknown;
  };
  isApiErrorMessage?: boolean;
  error?: string;
}

export interface RawUserEntry extends RawEntryBase {
  type: "user";
  message?: {
    role?: string;
    content?: string | RawContentBlock[];
    [key: string]: unknown;
  };
  toolUseResult?: unknown;
}

export type RawEntry = RawUserEntry | RawAssistantEntry | RawEntryBase;
