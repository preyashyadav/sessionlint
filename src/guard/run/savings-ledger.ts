/**
 * Append-only ledger of `sessionlint run` outcomes, one JSON line per run —
 * the raw material for Task 5's morning-after report. Never overwritten.
 */

import { homedir } from "os";
import { appendFile, mkdir } from "fs/promises";
import { dirname, join } from "path";
import type { RunResult } from "./types";

export interface LedgerEntry {
  timestamp: string; // ISO
  result: RunResult;
}

export function defaultLedgerPath(): string {
  return join(homedir(), ".sessionlint", "savings-ledger.jsonl");
}

export async function appendLedgerEntry(ledgerPath: string, entry: LedgerEntry): Promise<void> {
  await mkdir(dirname(ledgerPath), { recursive: true });
  await appendFile(ledgerPath, JSON.stringify(entry) + "\n", "utf8");
}
