/**
 * Line-by-line JSONL streaming parse of one session file. A malformed line
 * is skipped and counted, never thrown — one bad line must not lose the
 * rest of the session. A pathologically large single line is skipped and
 * counted separately (never JSON-parsed), so a hostile/corrupt transcript
 * can't force an unbounded parse.
 */

import { createReadStream } from "fs";
import { createInterface } from "readline";
import type { RawEntry } from "./schema";

export interface ParsedLine {
  lineNumber: number;
  raw: RawEntry;
}

export interface ParseResult {
  lines: ParsedLine[];
  /** Lines that were non-empty but failed JSON.parse. */
  parseErrorCount: number;
  /** Lines skipped because they exceeded MAX_LINE_CHARS (counted, never parsed). */
  oversizedLineCount: number;
}

/** A single JSONL entry above this many characters is treated as corrupt/hostile and skipped
 * rather than parsed. Chosen well above any legitimate real entry (large tool results included)
 * so it never trips on real transcripts, while bounding the cost of a pathological line. */
export const MAX_LINE_CHARS = 25_000_000;

export async function parseSessionFile(filePath: string): Promise<ParseResult> {
  const lines: ParsedLine[] = [];
  let parseErrorCount = 0;
  let oversizedLineCount = 0;
  let lineNumber = 0;

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    lineNumber++;
    if (line.length > MAX_LINE_CHARS) {
      oversizedLineCount++;
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const raw = JSON.parse(trimmed) as RawEntry;
      lines.push({ lineNumber, raw });
    } catch {
      parseErrorCount++;
    }
  }

  return { lines, parseErrorCount, oversizedLineCount };
}
