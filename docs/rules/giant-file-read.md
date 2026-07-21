# giant-file-read

**A very large file was read whole into context**

## What it detects

Fires when a single Read pulls more than 1,000 lines INTO CONTEXT (the tool result's numLines), not when the file on disk happens to be large. An offset/limit-bounded read of 30 lines from a 10,000-line file does not fire — that is the recommended behaviour. Multiple reads in one turn are deduplicated into one finding with a count.

## Why it costs you

Lines loaded into context are re-carried by every subsequent API call in the session. Reading 10,000 lines is roughly 100k tokens of mostly-unused ballast; reading 30 lines out of that same file is not.

## How to fix it

Use Grep to find the relevant part, or an offset/limit-bounded Read for the section you actually need. Point the model at specific line ranges instead of whole files.

## How the $ range is computed

Tokens are measured from the tool result's real content (~4 chars/token) whenever the transcript carries it, and only the over-threshold share is counted. The older ~10 tokens-per-line figure is now a fallback, used only when content is unavailable (e.g. sanitized fixtures), and is labeled in the finding when it applies.

---

*Generated from `src/report/rule-docs.ts` — edit there, not here. Suppress with `sessionlint --suppress giant-file-read`.*
