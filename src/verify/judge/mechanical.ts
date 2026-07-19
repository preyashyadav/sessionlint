/**
 * T1 mechanical check (Phase 2, Task 4). Deterministic, no LLM call — a
 * fail here is final (the LLM judge is never invoked). Our candidates are
 * tool-call-free terminal text turns (Task 1's nomination scope), so
 * there's no diff to apply; the mechanical checks that actually apply are
 * non-emptiness and preservation of concrete "fact tokens" (quoted
 * identifiers, file-like names, numbers) from the original response — a
 * real omission of a specific fact is checkable without judgment calls.
 */

import type { MechanicalCheckResult } from "./types";

const FACT_TOKEN_RE = /`[^`]+`|\b[\w-]+\.[a-zA-Z0-9]{1,5}\b|\b\d+\b/g;

function extractFactTokens(text: string): Set<string> {
  const matches = text.match(FACT_TOKEN_RE) ?? [];
  return new Set(matches.map((t) => t.toLowerCase()));
}

export function mechanicalCheck(original: string, replayed: string): MechanicalCheckResult {
  const reasons: string[] = [];

  if (original.trim().length > 0 && replayed.trim().length === 0) {
    reasons.push("replayed response is empty while the original was not");
    return { verdict: "fail", reasons };
  }

  const originalTokens = extractFactTokens(original);
  const replayedTokens = extractFactTokens(replayed);
  for (const token of originalTokens) {
    if (!replayedTokens.has(token)) reasons.push(`missing fact token from original: ${token}`);
  }

  return { verdict: reasons.length === 0 ? "pass" : "fail", reasons };
}
