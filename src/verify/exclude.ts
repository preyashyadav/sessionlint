/**
 * Sampler exclusion rules (Phase 2, Task 2).
 *
 * Secret-pattern match: secrets must never leave the machine, even toward
 * the user's own API key during replay (Task 3 sends the reconstructed
 * turn to the real API) — this is a hard safety requirement, not a quality
 * heuristic, so it scans the WHOLE turn's text (human prompt + assistant
 * response), not just the initiating prompt. Pattern reused from
 * scripts/sanitize-fixture.ts's proven SECRET_RE.
 *
 * Stateful-context contamination: the phase spec doesn't define this term
 * precisely and there's no strong on-disk signal to calibrate a fancier
 * heuristic against (same epistemic situation as the parked Phase 1 rules —
 * see MASTER.md §8). First cut (any Write/Edit/Bash in the immediately-
 * preceding turn) was checked against real history and excluded 75% of
 * candidates — nearly every wrap-up turn follows *some* edit, so that's too
 * broad to be useful. Narrowed per human decision: only exclude when the
 * candidate turn's own text references the SAME file the preceding turn's
 * mutating tool touched — that's the case where the text's correctness is
 * actually entangled with a specific real-world mutation we can't
 * independently re-verify, not just "an edit happened recently."
 */

import { extractAllTurnText } from "../rules/util";
import type { Session, Turn } from "../adapters/claude-code/types";

const SECRET_RE =
  /(sk-(ant-)?[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]+-----|Bearer\s+[A-Za-z0-9._-]{16,})/i;

export function hasSecretPattern(turn: Turn): boolean {
  return SECRET_RE.test(extractAllTurnText(turn));
}

const STATEFUL_TOOLS = new Set(["Write", "Edit", "NotebookEdit", "Bash"]);

/** File paths touched by state-mutating tool_use blocks in a turn (Bash has no structured
 * file_path input, so it never contributes a path here — it simply can't trigger this
 * narrowed check, which is an intentional consequence of requiring a concrete file reference). */
function statefulToolFilePaths(turn: Turn): string[] {
  const paths: string[] = [];
  for (const entry of turn.entries) {
    if (entry.kind !== "assistant-message" && entry.kind !== "assistant-error") continue;
    const content = (entry.raw as { message?: { content?: unknown } }).message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const b = block as { type?: unknown; name?: unknown; input?: unknown };
      if (b.type !== "tool_use" || typeof b.name !== "string" || !STATEFUL_TOOLS.has(b.name)) continue;
      const filePath = b.input && typeof b.input === "object" ? (b.input as { file_path?: unknown }).file_path : undefined;
      if (typeof filePath === "string" && filePath.length > 0) paths.push(filePath);
    }
  }
  return paths;
}

export function precededByStatefulTool(session: Session, turn: Turn): boolean {
  const index = session.turns.findIndex((t) => t.turnId === turn.turnId);
  if (index <= 0) return false;

  const paths = statefulToolFilePaths(session.turns[index - 1]!);
  if (paths.length === 0) return false;

  const turnText = extractAllTurnText(turn);
  return paths.some((path) => {
    const basename = path.split("/").pop() ?? path;
    const stem = basename.replace(/\.[^./]+$/, "");
    return turnText.includes(path) || turnText.includes(basename) || (stem.length > 2 && turnText.includes(stem));
  });
}
