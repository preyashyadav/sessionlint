import type { ContextStratum, TaskFamily } from "./types";

/** Context-size strata per the phase spec: <10k / 10-50k / >50k tokens. */
export function contextStratum(tokens: number): ContextStratum {
  if (tokens < 10_000) return "small";
  if (tokens <= 50_000) return "medium";
  return "large";
}

// Heuristic only — a rough keyword bucket for sampling diversity, not a claim about
// what the task "really" was (never surfaced as a user-facing verdict, D-005 spirit).
// Order matters: first match wins, so more specific families are checked first.
const TASK_FAMILY_PATTERNS: Array<[TaskFamily, RegExp]> = [
  ["bugfix", /\b(fix|bug|error|crash|broken|regression)\b/i],
  ["test", /\b(tests?|spec|coverage)\b/i],
  ["refactor", /\b(refactor|clean ?up|reorgani[sz]e|rename)\b/i],
  ["docs", /\b(docs?|readme|documentation|comment)\b/i],
  ["feature", /\b(add|implement|feature|build|create)\b/i],
];

export function classifyTaskFamily(promptText: string | null): TaskFamily {
  if (!promptText) return "other";
  for (const [family, pattern] of TASK_FAMILY_PATTERNS) {
    if (pattern.test(promptText)) return family;
  }
  return "other";
}
