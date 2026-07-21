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
/** FALLBACK ASSUMPTION only — used when a tool_result carries no readable content
 * (sanitized fixtures length-bucket string content). Real transcripts carry
 * `toolUseResult.file.content`, and its character count is used in preference to this. */
export const TOKENS_PER_LINE_ASSUMPTION = 10;
/** Standard chars-per-token approximation, used when real content IS available. */
export const CHARS_PER_TOKEN = 4;

interface GiantRead {
  /** Lines actually loaded into context by THIS read. */
  linesRead: number;
  /** Size of the whole file on disk — context, not cost. */
  totalLines: number | null;
  /** Real token estimate from the content that entered context, when recoverable. */
  measuredTokens: number | null;
}

/**
 * A Read tool_result carries BOTH `numLines` (what this read actually pulled into
 * context) and `totalLines` (how big the file is on disk). Only the first is a cost.
 *
 * This rule previously keyed on `totalLines`, which made it fire on the SIZE OF THE FILE
 * rather than on what was loaded — so an offset-limited Read of 30 lines from a
 * 10,437-line file was reported as a 10,437-line read and billed accordingly. Measured
 * against real history that overstated avoidable tokens by 51x (571,540 assumed vs
 * ~11,162 actually in context), and flagged the user for doing exactly what the rule
 * recommends. `numLines` is the honest trigger and the honest cost basis.
 */
function giantReadOf(entry: Entry): GiantRead | null {
  const raw = entry.raw as { toolUseResult?: unknown };
  const tur = raw.toolUseResult;
  if (!tur || typeof tur !== "object") return null;
  const file = (tur as { file?: unknown }).file;
  if (!file || typeof file !== "object") return null;

  const f = file as { numLines?: unknown; totalLines?: unknown; content?: unknown };
  const totalLines = typeof f.totalLines === "number" ? f.totalLines : null;
  // Prefer numLines; fall back to totalLines only when numLines is absent (older schema),
  // where the whole file really was the read.
  const linesRead = typeof f.numLines === "number" ? f.numLines : totalLines;
  if (linesRead === null) return null;

  const measuredTokens =
    typeof f.content === "string" ? Math.ceil(f.content.length / CHARS_PER_TOKEN) : null;

  return { linesRead, totalLines, measuredTokens };
}

export function detectGiantFileReads(session: Session, asOf: Date = new Date()): Finding[] {
  const findings: Finding[] = [];

  for (let turnIndex = 0; turnIndex < session.turns.length; turnIndex++) {
    const turn = session.turns[turnIndex]!;
    // A turn can re-read the same giant file several times (verified against real history:
    // 5 genuinely distinct entries, same file, one turn) — one finding per turn keeps the
    // screenshot-optimized report readable instead of repeating the same line 5 times.
    const giantReads: GiantRead[] = [];
    for (const entry of turn.entries) {
      const read = giantReadOf(entry);
      if (read && read.linesRead > GIANT_FILE_READ_LINE_THRESHOLD) giantReads.push(read);
    }
    if (giantReads.length === 0) continue;

    const maxLines = Math.max(...giantReads.map((r) => r.linesRead));
    const countNote = giantReads.length > 1 ? `, read ${giantReads.length} times in this turn` : "";

    // Counterfactual: each read stays within the threshold (Grep / offset-limited Read).
    // Every read past that adds its excess to context as a separate tool_result — N
    // re-reads really do mean N copies carried. When the real content is recoverable the
    // excess is prorated from MEASURED tokens; the per-line constant is only a fallback.
    const measuredEverywhere = giantReads.every((r) => r.measuredTokens !== null);
    const avoidableTokens = giantReads.reduce((sum, r) => {
      const excessLines = r.linesRead - GIANT_FILE_READ_LINE_THRESHOLD;
      if (r.measuredTokens !== null) {
        // Prorate the measured token count down to just the over-threshold portion.
        return sum + Math.ceil(r.measuredTokens * (excessLines / r.linesRead));
      }
      return sum + excessLines * TOKENS_PER_LINE_ASSUMPTION;
    }, 0);
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
        measuredEverywhere
          ? `token count measured from the tool result's real content (~${CHARS_PER_TOKEN} chars/token)`
          : `~${TOKENS_PER_LINE_ASSUMPTION} tokens per line (this transcript carries no readable tool-result content)`,
        "counts only the lines this read actually loaded into context, not the file's total size",
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
