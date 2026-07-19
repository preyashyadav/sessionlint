# late-compaction

**Context filled up before anyone compacted**

## What it detects

Fires on an automatic compaction (trigger: "auto" in the transcript's compactMetadata) — meaning the context window filled to the brim before compaction happened. A manual /compact is the user proactively managing context and is never flagged.

## Why it costs you

Every turn between 'context got huge' and 'compaction finally ran' carried the excess tokens at real cost. Auto-compaction also happens at the worst possible moment (mid-task) and drops context you didn't choose to drop.

## How to fix it

Run /compact (or /clear, if the topic changed) at a natural boundary before the window fills — the flagged turn range shows where the growth started.

## How the $ range is computed

Counterfactual: a proactive /compact at the start of the growth window would have reduced context to this compaction's own observed post-size (a real datapoint, not a constant). Both bounds are grounded in billing that actually occurred — never a hypothetical charge exceeding the session's real spend.

---

*Generated from `src/report/rule-docs.ts` — edit there, not here. Suppress with `sessionlint --suppress late-compaction`.*
