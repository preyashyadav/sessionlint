/**
 * Shared cost-attribution helpers for lint rules (Phase 5 Task 1 / D-008 P0).
 *
 * Every rule's costImpact is a range spanning two labeled counterfactual
 * assumptions (the cache-nuke pattern) — never a point estimate (D-004).
 * Context sizes come from the verified single-call helpers (turnContextSize
 * reads the LAST API call's raw usage bag), never Turn.usage aggregates,
 * which are billing sums that overcount context 10-20x on multi-call turns
 * (MASTER.md §7, 2026-07-11).
 *
 * "Carrying cost" here means: context that stayed in the window is re-billed
 * on every subsequent API call — at cache-read rate (0.1x input) when the
 * cache holds, at cache-write rate (1.25x input) when it expired and had to
 * be re-written. Low bounds assume the cheap case throughout; high bounds add
 * a labeled worst-case assumption. All rates resolve through src/pricing/
 * (C-2); an unpriced model contributes nothing rather than a guessed rate.
 */

import { getModelRate, type ResolvedRate } from "../pricing/rates";
import { turnContextSize } from "./util";
import type { Session } from "../adapters/claude-code/types";

/** The turn's own model rate, else the nearest EARLIER priced turn's — a turn without a
 * billable model (e.g. <synthetic> tool-result stitching) had its content billed under the
 * surrounding real model. Null when nothing before it is priced either. */
export function resolveTurnRate(session: Session, turnIndex: number, asOf: Date): ResolvedRate | null {
  for (let i = turnIndex; i >= 0; i--) {
    const model = session.turns[i]!.model;
    if (!model) continue;
    const rate = getModelRate(model, asOf);
    if (rate) return rate;
  }
  return null;
}

/** Cache-read carrying cost (USD) of context above `baselineTokens` across turns
 * [fromIndex, toIndexExclusive). Turns that resolve no priced model are skipped
 * (undercounts — conservative), never guessed. */
export function excessCarryCost(
  session: Session,
  fromIndex: number,
  toIndexExclusive: number,
  baselineTokens: number,
  asOf: Date
): number {
  let carryUsd = 0;
  const end = Math.min(toIndexExclusive, session.turns.length);
  for (let i = Math.max(0, fromIndex); i < end; i++) {
    const excess = Math.max(0, turnContextSize(session.turns[i]!) - baselineTokens);
    if (excess === 0) continue;
    const rate = resolveTurnRate(session, i, asOf);
    if (!rate) continue;
    carryUsd += (excess / 1_000_000) * rate.cacheReadPerMTok;
  }
  return carryUsd;
}
