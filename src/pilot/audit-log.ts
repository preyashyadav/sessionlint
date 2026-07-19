/**
 * Append-only audit log for PILOT's effectful actions (D-003: every effect
 * must be logged). One JSON line per action — never overwritten, never
 * pruned automatically.
 */

import { appendFile, mkdir } from "fs/promises";
import { dirname } from "path";

export interface AuditEntry {
  timestamp: string; // ISO
  action: string;
  detail: Record<string, unknown>;
}

export async function appendAuditEntry(logPath: string, entry: AuditEntry): Promise<void> {
  await mkdir(dirname(logPath), { recursive: true });
  await appendFile(logPath, JSON.stringify(entry) + "\n", "utf8");
}
