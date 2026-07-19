/**
 * Stratified sampler (Phase 2, Task 2). Takes every nominated candidate
 * across all loaded sessions, applies the exclusion rules, buckets
 * survivors by (context stratum x task family), and round-robins across
 * buckets (deterministic — no randomness, so results are reproducible)
 * until `n` is reached or every bucket is exhausted.
 */

import type { LoadedSession } from "../adapters/claude-code/session";
import { hasSecretPattern, precededByStatefulTool } from "./exclude";
import { nominateCandidates } from "./nominate";
import { classifyTaskFamily, contextStratum } from "./stratify";
import type { ExclusionReason, SampleOptions, SampleResult, StratifiedCandidate } from "./types";
import { extractPromptText } from "../rules/util";

export const DEFAULT_SAMPLE_SIZE = 40;

export function stratifiedSample(loaded: LoadedSession[], options: SampleOptions = {}): SampleResult {
  const n = options.n ?? DEFAULT_SAMPLE_SIZE;
  const excluded: ExclusionReason[] = [];
  const survivors: StratifiedCandidate[] = [];

  for (const { session } of loaded) {
    for (const candidate of nominateCandidates(session)) {
      const turn = session.turns.find((t) => t.turnId === candidate.turnId);
      if (!turn) continue;

      if (hasSecretPattern(turn)) {
        excluded.push({ sessionId: candidate.sessionId, turnId: candidate.turnId, reason: "secret-pattern-match" });
        continue;
      }
      if (precededByStatefulTool(session, turn)) {
        excluded.push({
          sessionId: candidate.sessionId,
          turnId: candidate.turnId,
          reason: "stateful-context-contamination",
        });
        continue;
      }

      survivors.push({
        ...candidate,
        contextStratum: contextStratum(candidate.contextSizeAtTurn),
        taskFamily: classifyTaskFamily(extractPromptText(turn)),
      });
    }
  }

  const buckets = new Map<string, StratifiedCandidate[]>();
  for (const candidate of survivors) {
    const key = `${candidate.contextStratum}:${candidate.taskFamily}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(candidate);
    else buckets.set(key, [candidate]);
  }
  const bucketKeys = [...buckets.keys()].sort();

  const sampled: StratifiedCandidate[] = [];
  let madeProgress = true;
  while (sampled.length < n && madeProgress) {
    madeProgress = false;
    for (const key of bucketKeys) {
      if (sampled.length >= n) break;
      const next = buckets.get(key)!.shift();
      if (next) {
        sampled.push(next);
        madeProgress = true;
      }
    }
  }

  return { sampled, excluded };
}
