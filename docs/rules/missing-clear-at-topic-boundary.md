# missing-clear-at-topic-boundary

**Context grew huge and was never cleared or compacted**

## What it detects

Fires once per session, at the first turn where context crosses a high absolute size threshold and then never gets a /clear or /compact for the rest of the session. Deliberately conservative (precision over recall): there is no real topic-boundary marker in the transcript schema, so only unambiguous cases fire.

## Why it costs you

Everything after the crossing pays to carry context the conversation may no longer need — at minimum cache-read rate on every single call.

## How to fix it

When a task wraps up and a new one starts, /clear (new topic) or /compact (same topic, stale detail) before continuing.

## How the $ range is computed

Low bound: only the post-crossing growth was avoidable. High bound: a /clear would have dropped the entire carried context. Both bill carried context at cache-read rate — real cache expiries bill higher, so even the high bound is not inflated.

---

*Generated from `src/report/rule-docs.ts` — edit there, not here. Suppress with `sessionlint --suppress missing-clear-at-topic-boundary`.*
