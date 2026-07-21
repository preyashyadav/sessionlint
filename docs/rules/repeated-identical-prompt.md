# repeated-identical-prompt

**The same prompt was retried verbatim**

## What it detects

Fires when a human prompt is submitted again, byte-identical, immediately after the previous turn — the shape of 'retry right after an unsatisfying response'. Distant coincidental repeats do not fire. Harness-injected text is ignored: slash-command echoes (<local-command-caveat>, <command-name>, ...) and <system-reminder> blocks look like user messages in the transcript but are not human-authored, so two identical ones in a row are the harness being consistent, not a retry.

## Why it costs you

An immediate verbatim retry implies the first attempt's response was discarded — its cost bought nothing. Rephrasing with more direction usually beats re-rolling the dice.

## How to fix it

If the first answer missed, say what was wrong with it (or /undo and refine the prompt) instead of resending the identical text.

## How the $ range is computed

Bounds from the first attempt's ACTUAL billed cost via the cost engine: low = only its discarded output was waste; high = the entire attempt (input + cache + output) was waste.

---

*Generated from `src/report/rule-docs.ts` — edit there, not here. Suppress with `sessionlint --suppress repeated-identical-prompt`.*
