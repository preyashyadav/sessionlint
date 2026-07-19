/**
 * Per-session capability report: names exactly what's missing/degraded
 * rather than silently dropping data or crashing. Pure function — no file
 * I/O — so it's testable with hand-built Session objects.
 */

import type { CapabilityGap, CapabilityId, CapabilityReport } from "../types";
import type { Session } from "./types";

// MASTER.md §9 / §6: CC versions verified against the real fixture corpus.
const KNOWN_VERIFIED_VERSIONS = new Set([
  "2.1.179",
  "2.1.183",
  "2.1.186",
  "2.1.195",
  "2.1.198",
  "2.1.199",
  "2.1.201",
  "2.1.202",
  "2.1.204",
]);

export interface ParseStats {
  invalidModelCount: number;
  usedTurnGroupingFallback: boolean;
}

export function computeCapabilityReport(session: Session, stats: ParseStats): CapabilityReport {
  const gaps: CapabilityGap[] = [];
  const supported: CapabilityId[] = [];

  const turnCount = session.turns.length;
  const turnsWithText = session.turns.filter((t) => t.content.hasText).length;
  const turnsWithValidModel = session.turns.filter((t) => t.modelValid).length;
  const turnsWithToolUse = session.turns.filter((t) => t.content.toolUseNames.length > 0).length;
  const turnsWithToolResult = session.turns.filter((t) => t.content.toolResultCount > 0).length;
  const turnsWithUsage = session.turns.filter((t) => t.usage !== null).length;
  const assistantEntryCount = session.turns.reduce(
    (n, t) => n + t.entries.filter((e) => e.kind === "assistant-message" || e.kind === "assistant-error").length,
    0
  );

  // content-text
  if (turnsWithText > 0) {
    supported.push("content-text");
  } else {
    gaps.push({
      capability: "content-text",
      severity: turnCount === 0 ? "missing" : "degraded",
      reason: "no turn has recoverable text content",
    });
  }

  // model-recoverable
  if (turnsWithValidModel > 0) {
    supported.push("model-recoverable");
  } else {
    gaps.push({
      capability: "model-recoverable",
      severity: turnCount === 0 ? "missing" : "degraded",
      reason: "no turn has a validly-shaped model field",
    });
  }
  if (stats.invalidModelCount > 0) {
    gaps.push({
      capability: "model-recoverable",
      severity: "info",
      reason: `${stats.invalidModelCount} assistant ${stats.invalidModelCount === 1 ? "entry" : "entries"} had a model field that failed shape validation`,
    });
  }

  // tool-call-recoverable / tool-result-recoverable
  if (turnsWithToolUse > 0) {
    supported.push("tool-call-recoverable");
  } else {
    gaps.push({
      capability: "tool-call-recoverable",
      severity: turnsWithText > 0 ? "degraded" : "missing",
      reason: "no recoverable tool_use blocks in any turn",
    });
  }
  if (turnsWithToolResult > 0) {
    supported.push("tool-result-recoverable");
  } else {
    gaps.push({
      capability: "tool-result-recoverable",
      severity: turnsWithText > 0 ? "degraded" : "missing",
      reason: "no recoverable tool_result blocks in any turn",
    });
  }

  // usage-fields — only meaningful to check if there's at least one assistant entry to have usage on
  if (assistantEntryCount > 0) {
    if (turnsWithUsage > 0) {
      supported.push("usage-fields");
    } else {
      gaps.push({
        capability: "usage-fields",
        severity: "missing",
        reason: "assistant entries present but none carry a usage field",
      });
    }
  }

  // turn-grouping
  if (stats.usedTurnGroupingFallback) {
    gaps.push({
      capability: "turn-grouping",
      severity: "degraded",
      reason: "promptId absent for some entries; used parent-chain heuristic to synthesize turn boundaries",
    });
  } else {
    supported.push("turn-grouping");
  }

  // version-known
  if (session.ccVersions.length === 0) {
    gaps.push({
      capability: "version-known",
      severity: "degraded",
      reason: "no CC version marker found in session",
    });
  } else {
    const unknownVersions = session.ccVersions.filter((v) => !KNOWN_VERIFIED_VERSIONS.has(v));
    for (const v of unknownVersions) {
      gaps.push({
        capability: "version-known",
        severity: "info",
        reason: `CC version ${v} not yet verified against fixtures; parsed using best-effort schema assumptions`,
        detail: v,
      });
    }
    if (unknownVersions.length === 0) supported.push("version-known");
  }

  // entry-type-known
  const unknownTypeNames = Object.keys(session.unknownTypeCounts);
  if (unknownTypeNames.length === 0) {
    supported.push("entry-type-known");
  } else {
    for (const typeName of unknownTypeNames) {
      gaps.push({
        capability: "entry-type-known",
        severity: "info",
        reason: `unrecognized entry type: "${typeName}"`,
        detail: `count: ${session.unknownTypeCounts[typeName]}`,
      });
    }
  }

  return {
    ccVersion: session.ccVersions[0] ?? null,
    supported,
    gaps,
  };
}
