/**
 * Line-by-line JSONL streaming parse of one session file. A malformed line
 * is skipped and counted, never thrown — one bad line must not lose the
 * rest of the session.
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
  parseErrorCount: number;
}

export async function parseSessionFile(filePath: string): Promise<ParseResult> {
  const lines: ParsedLine[] = [];
  let parseErrorCount = 0;
  let lineNumber = 0;

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    lineNumber++;
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const raw = JSON.parse(trimmed) as RawEntry;
      lines.push({ lineNumber, raw });
    } catch {
      parseErrorCount++;
    }
  }

  return { lines, parseErrorCount };
}
