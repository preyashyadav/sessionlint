# giant-file-read

**A very large file was read whole into context**

## What it detects

Fires when a Read tool result spans more than 1,000 lines (threshold calibrated against real local history). Multiple reads of the same file in one turn are deduplicated into one finding with a count.

## Why it costs you

The whole file becomes context that every subsequent API call in the session re-carries. A 10,000-line file is roughly 100k tokens of mostly-unused ballast.

## How to fix it

Use Grep to find the relevant part, or an offset/limit-bounded Read for the section you actually need. Point the model at specific line ranges instead of whole files.

## How the $ range is computed

ASSUMPTION (labeled in every finding): ~10 tokens per source line, because the transcript records only line counts, never per-tool-result token counts.

---

*Generated from `src/report/rule-docs.ts` — edit there, not here. Suppress with `sessionlint --suppress giant-file-read`.*
