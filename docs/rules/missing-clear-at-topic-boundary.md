# missing-clear-at-topic-boundary

**Context grew huge and was never cleared or compacted**

## What it detects

Fires once per session, at the first turn where context crosses 75% of the model's context window (750k of a 1M window; 150k on Haiku's 200k) and then never gets a /clear or /compact for the rest of the session. Does not fire when the crossing happens in the last few turns — advising a /clear on a session that is already ending is not actionable. Deliberately conservative (precision over recall): there is no real topic-boundary marker in the transcript schema, so only unambiguous cases fire.

## Why it costs you

Everything after the crossing pays to carry context the conversation may no longer need — at minimum cache-read rate on every single call.

## How to fix it

When a task wraps up and a new one starts, /clear (new topic) or /compact (same topic, stale detail) before continuing.

## How the $ range is computed

Low bound: only the post-crossing growth was avoidable. High bound: a /clear would have dropped the entire carried context. The high bound is a CEILING, not an expectation — it assumes none of the carried context was needed afterwards, which is usually false in a session that kept doing useful work; treat the low bound as the realistic figure. Both bill carried context at cache-read rate (the cheapest rate), so neither is inflated.

---

*Generated from `src/report/rule-docs.ts` — edit there, not here. Suppress with `sessionlint --suppress missing-clear-at-topic-boundary`.*
