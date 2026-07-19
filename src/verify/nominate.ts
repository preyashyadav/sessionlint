/**
 * Candidate nomination (Phase 2, Task 1). Nominates downgrade-candidate
 * turns for the stratified sampler (Task 2) and replay+judge pipeline
 * (Tasks 3-4) to actually verify — this classifier never itself claims a
 * turn was overpriced or that a cheaper model would have matched (D-005
 * spirit: no per-prompt routing claims, ever). It only narrows the field to
 * turns worth checking: no tool calls (terminal text turns — commit
 * messages, summaries, explanations, per the phase spec), run on a
 * premium-tier model where a downgrade path plausibly exists.
 */

import type { LoadedSession } from "../adapters/claude-code/session";
import type { Session } from "../adapters/claude-code/types";
import { turnContextSize } from "../rules/util";
import type { CandidateTurn } from "./types";

const PREMIUM_MODEL_PREFIXES = ["claude-opus", "claude-fable", "claude-mythos"];

export function isPremiumModel(model: string): boolean {
  return PREMIUM_MODEL_PREFIXES.some((prefix) => model.startsWith(prefix));
}

export function nominateCandidates(session: Session): CandidateTurn[] {
  const candidates: CandidateTurn[] = [];

  for (const turn of session.turns) {
    if (!turn.model || !isPremiumModel(turn.model)) continue;
    if (!turn.content.hasText) continue; // nothing to compare against a cheaper model
    if (turn.content.toolUseNames.length > 0) continue; // must be a terminal, tool-call-free turn

    candidates.push({
      sessionId: session.sessionId,
      turnId: turn.turnId,
      model: turn.model,
      contextSizeAtTurn: turnContextSize(turn),
    });
  }

  return candidates;
}

export function nominateAcrossSessions(loaded: LoadedSession[]): CandidateTurn[] {
  return loaded.flatMap(({ session }) => nominateCandidates(session));
}
