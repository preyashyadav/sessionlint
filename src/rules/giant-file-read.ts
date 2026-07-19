/**
 * Giant-file-read into context. Verified real signal: a Read tool's result
 * entry carries `toolUseResult.file.totalLines` — a number, so it survives
 * fixture sanitization intact (unlike string content, which the sanitizer
 * length-buckets and caps at 2000 chars). Real corpus calibration: 13 reads
 * over 1000 lines across the local history, so that's the threshold used.
 */

import { resolveTurnRate } from "./cost-impact";
import type { Entry, Session } from "../adapters/claude-code/types";
import type { CostImpactRange, Finding, Rule } from "./types";

export const GIANT_FILE_READ_RULE_ID = "giant-file-read";
export const GIANT_FILE_READ_LINE_THRESHOLD = 1000;
/** ASSUMPTION: ~10 tokens per source line. The transcript records only line counts
 * (toolUseResult.file.totalLines), never the content's real token count — the sanitizer
 * length-buckets string content, and even raw logs don't carry per-tool-result token
 * figures. 10/line ≈ 40-60 chars/line at ~4-5 chars/token, labeled in every finding. */
export const TOKENS_PER_LINE_ASSUMPTION = 10;

function totalLinesOf(entry: Entry): number | null {
  const raw = entry.raw as { toolUseResult?: unknown };
  const tur = raw.toolUseResult;
  if (!tur || typeof tur !== "object") return null;
  const file = (tur as { file?: unknown }).file;
  if (!file || typeof file !== "object") return null;
  const n = (file as { totalLines?: unknown }).totalLines;
  return typeof n === "number" ? n : null;
}

export function detectGiantFileReads(session: Session, asOf: Date = new Date()): Finding[] {
  const findings: Finding[] = [];

  for (let turnIndex = 0; turnIndex < session.turns.length; turnIndex++) {
    const turn = session.turns[turnIndex]!;
    // A turn can re-read the same giant file several times (verified against real history:
    // 5 genuinely distinct entries, same file, one turn) — one finding per turn keeps the
    // screenshot-optimized report readable instead of repeating the same line 5 times.
    const giantReads: number[] = [];
    for (const entry of turn.entries) {
      const lines = totalLinesOf(entry);
      if (lines !== null && lines > GIANT_FILE_READ_LINE_THRESHOLD) giantReads.push(lines);
    }
    if (giantReads.length === 0) continue;

    const maxLines = Math.max(...giantReads);
    const countNote = giantReads.length > 1 ? `, read ${giantReads.length} times in this turn` : "";

    // Counterfactual: each read stays within the threshold (Grep / offset-limited Read).
    // Every read past that adds its excess lines to context as a separate tool_result —
    // N re-reads really do mean N copies carried.
    const avoidableTokens =
      giantReads.reduce((sum, lines) => sum + (lines - GIANT_FILE_READ_LINE_THRESHOLD), 0) *
      TOKENS_PER_LINE_ASSUMPTION;
    const rate = resolveTurnRate(session, turnIndex, asOf);
    const turnsAfter = session.turns.length - 1 - turnIndex;

    let costImpact: CostImpactRange | undefined;
    let assumptions: string[] | undefined;
    if (rate && avoidableTokens > 0) {
      const mtok = avoidableTokens / 1_000_000;
      costImpact = {
        // low: the excess was billed exactly once at base input rate, then never carried.
        low: mtok * rate.inputPerMTok,
        // high: cache-written once (1.25x), then carried as a cache read on every later turn.
        high: mtok * rate.cacheWrite5mPerMTok + mtok * rate.cacheReadPerMTok * turnsAfter,
      };
      assumptions = [
        `~${TOKENS_PER_LINE_ASSUMPTION} tokens per line (the transcript records line counts, not token counts)`,
        `counterfactual: each read stays within the ${GIANT_FILE_READ_LINE_THRESHOLD.toLocaleString()}-line threshold (Grep or offset-limited Read)`,
        "low: excess billed once at input rate; high: cache-written once, then carried as cache reads to session end",
      ];
    }

    findings.push({
      ruleId: GIANT_FILE_READ_RULE_ID,
      severity: "warning",
      turnRange: { fromTurnId: turn.turnId, toTurnId: turn.turnId },
      evidence:
        `A file read into context spanned ${maxLines.toLocaleString()} lines${countNote} (over the ` +
        `${GIANT_FILE_READ_LINE_THRESHOLD.toLocaleString()}-line threshold) — consider Grep or an ` +
        "offset-limited Read instead of loading the whole file.",
      costImpact,
      assumptions,
    });
  }

  return findings;
}

export const giantFileReadRule: Rule = {
  id: GIANT_FILE_READ_RULE_ID,
  detector: detectGiantFileReads,
  fixDocUrl: "https://github.com/preyashyadav/sessionlint/blob/main/docs/rules/giant-file-read.md",
  suppressible: true,
};
