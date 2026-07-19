/**
 * Orchestration: discover → parse → reconstruct → capability-report, as one
 * call. This is the adapter's main entry point for consumers (cost engine,
 * cache-nuke detector, rules, report).
 */

import type { CapabilityReport } from "../types";
import { computeCapabilityReport } from "./capability";
import { discoverSessions, defaultRoot } from "./discover";
import { parseSessionFile } from "./parse";
import { buildSession } from "./turns";
import type { Session } from "./types";

export interface LoadedSession {
  session: Session;
  capabilities: CapabilityReport;
}

export async function loadSession(filePath: string, sessionIdHint: string | null = null): Promise<LoadedSession> {
  const parsed = await parseSessionFile(filePath);
  const { session, usedTurnGroupingFallback, invalidModelCount } = buildSession({
    filePath,
    sessionIdHint,
    rawEntries: parsed.lines,
    parseErrorCount: parsed.parseErrorCount,
  });
  const capabilities = computeCapabilityReport(session, {
    invalidModelCount,
    usedTurnGroupingFallback,
  });
  return { session, capabilities };
}

export async function loadSessions(root: string = defaultRoot()): Promise<LoadedSession[]> {
  const discovered = await discoverSessions(root);
  const results: LoadedSession[] = [];
  for (const d of discovered) {
    results.push(await loadSession(d.filePath, d.sessionId));
  }
  return results;
}
