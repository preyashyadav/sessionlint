/**
 * Canonical per-rule documentation — the single source behind `sessionlint explain <rule>`
 * and docs/rules/*.md. Every claim here must match the rule's actual implementation
 * (thresholds, cost-bound assumptions); when a rule changes, this file changes with it.
 */

export interface RuleDoc {
  id: string;
  title: string;
  what: string;
  why: string;
  fix: string;
  costNote: string;
}

export const RULE_DOCS: readonly RuleDoc[] = [
  {
    id: "cache-nuke",
    title: "Fresh-input processing after a mid-session model switch",
    what:
      "Fires when a session switches models mid-conversation and the next call reports fresh " +
      "input. The token count is directly observed. Attribution is conditional: if the idle " +
      "gap exceeds the default five-minute cache TTL, the cache may have expired without the " +
      "switch, so the finding is informational and assigns no avoidable cost.",
    why:
      "Within a warm-cache window, a model switch can prevent reuse of the old model's cache. " +
      "Outside that window, the rule reports the observed fresh input without claiming cause.",
    fix:
      "Pick the model before the context grows, or make the switch at a natural boundary after " +
      "/clear or /compact so there is little context to reprocess. If you switch to a CHEAPER " +
      "model, the finding's range can show a net save — the report says so rather than " +
      "pretending every switch is waste.",
    costNote:
      "Within the default TTL, the range spans two labeled assumptions: high assumes the cache " +
      "would have remained readable; low assumes the content might not have been cached anyway. " +
      "After the TTL, no avoidable-cost range is attributed to the switch.",
  },
  {
    id: "late-compaction",
    title: "Context filled up before anyone compacted",
    what:
      "Fires on an automatic compaction (trigger: \"auto\" in the transcript's compactMetadata) — " +
      "meaning the context window filled to the brim before compaction happened. A manual " +
      "/compact is the user proactively managing context and is never flagged.",
    why:
      "Every turn between 'context got huge' and 'compaction finally ran' carried the excess " +
      "tokens at real cost. Auto-compaction also happens at the worst possible moment (mid-task) " +
      "and drops context you didn't choose to drop.",
    fix:
      "Run /compact (or /clear, if the topic changed) at a natural boundary before the window " +
      "fills — the flagged turn range shows where the growth started.",
    costNote:
      "Counterfactual: a proactive /compact at the start of the growth window would have reduced " +
      "context to this compaction's own observed post-size (a real datapoint, not a constant). " +
      "Both bounds are grounded in billing that actually occurred — never a hypothetical charge " +
      "exceeding the session's real spend.",
  },
  {
    id: "giant-file-read",
    title: "A very large file was read whole into context",
    what:
      "Fires when a Read tool result spans more than 1,000 lines (threshold calibrated against " +
      "real local history). Multiple reads of the same file in one turn are deduplicated into " +
      "one finding with a count.",
    why:
      "The whole file becomes context that every subsequent API call in the session re-carries. " +
      "A 10,000-line file is roughly 100k tokens of mostly-unused ballast.",
    fix:
      "Use Grep to find the relevant part, or an offset/limit-bounded Read for the section you " +
      "actually need. Point the model at specific line ranges instead of whole files.",
    costNote:
      "ASSUMPTION (labeled in every finding): ~10 tokens per source line, because the transcript " +
      "records only line counts, never per-tool-result token counts.",
  },
  {
    id: "missing-clear-at-topic-boundary",
    title: "Context grew huge and was never cleared or compacted",
    what:
      "Fires once per session, at the first turn where context crosses a high absolute size " +
      "threshold and then never gets a /clear or /compact for the rest of the session. " +
      "Deliberately conservative (precision over recall): there is no real topic-boundary marker " +
      "in the transcript schema, so only unambiguous cases fire.",
    why:
      "Everything after the crossing pays to carry context the conversation may no longer need — " +
      "at minimum cache-read rate on every single call.",
    fix:
      "When a task wraps up and a new one starts, /clear (new topic) or /compact (same topic, " +
      "stale detail) before continuing.",
    costNote:
      "Low bound: only the post-crossing growth was avoidable. High bound: a /clear would have " +
      "dropped the entire carried context. Both bill carried context at cache-read rate — real " +
      "cache expiries bill higher, so even the high bound is not inflated.",
  },
  {
    id: "repeated-identical-prompt",
    title: "The same prompt was retried verbatim",
    what:
      "Fires when a human prompt is submitted again, byte-identical, immediately after the " +
      "previous turn — the shape of 'retry right after an unsatisfying response'. Distant " +
      "coincidental repeats do not fire.",
    why:
      "An immediate verbatim retry implies the first attempt's response was discarded — its " +
      "cost bought nothing. Rephrasing with more direction usually beats re-rolling the dice.",
    fix:
      "If the first answer missed, say what was wrong with it (or /undo and refine the prompt) " +
      "instead of resending the identical text.",
    costNote:
      "Bounds from the first attempt's ACTUAL billed cost via the cost engine: low = only its " +
      "discarded output was waste; high = the entire attempt (input + cache + output) was waste.",
  },
];

export function ruleDocById(id: string): RuleDoc | null {
  return RULE_DOCS.find((d) => d.id === id) ?? null;
}

export function renderRuleDoc(doc: RuleDoc): string {
  return [
    `${doc.id} — ${doc.title}`,
    "",
    `  What it detects: ${doc.what}`,
    "",
    `  Why it costs you: ${doc.why}`,
    "",
    `  How to fix it: ${doc.fix}`,
    "",
    `  How the $ range is computed: ${doc.costNote}`,
  ].join("\n");
}

export function renderRuleList(): string {
  const lines = ["sessionlint rules — run `sessionlint explain <rule>` for detail:", ""];
  for (const d of RULE_DOCS) lines.push(`  ${d.id.padEnd(34)} ${d.title}`);
  return lines.join("\n");
}
