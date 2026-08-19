# Ledger reconciliation experiment

**Question:** does a ledger rebuilt from Claude Code's JSONL transcripts agree with
Claude Code's own `cost.total_cost_usd` on the *interactive* path?

This matters because sessionlint's exactness claim rests on two billed `claude -p`
runs — both headless, both tiny, both with zero thinking tokens. The interactive
path that every real user is on has never been reconciled against anything.

The ground truth is free: Claude Code puts `cost.total_cost_usd` on the statusline
command's stdin on every render. `src/pilot/statusline-input.ts` already parses it
and nothing compares it to anything.

## Enable the capture

Add to the settings file for the config dir you actually work in
(`$CLAUDE_CONFIG_DIR/settings.json`, or `~/.claude/settings.json`):

```json
"statusLine": {
  "type": "command",
  "command": "/Users/preyashyadav/.bun/bin/bun run /Users/preyashyadav/Documents/personal-projects/sessionlint/scripts/experiment/capture-statusline.ts"
}
```

Then work normally. Every render appends one line to
`~/.sessionlint/experiment/statusline-samples.jsonl`.

The capture is designed to be invisible: it renders a real statusline
(`Opus 5 · ctx 20% · $1.23 · 5h 3%`), never throws, and always exits 0. Remove the
`statusLine` key to stop it. The log records only the accounting fields — no cwd,
no repo identifiers, no transcript contents.

If you run more than one account (`CLAUDE_CONFIG_DIR`), add it to each; the log
keys on `session_id`, so the corpora merge cleanly.

## Measure

```bash
bun run scripts/experiment/reconcile.ts              # table + verdict
bun run scripts/experiment/reconcile.ts --json       # per-session rows
bun run scripts/experiment/reconcile.ts --min-samples 3
```

## What it controls for

**The dedupe policy is the main confound.** If the ledger comes in under the
statusline, that could be a real transcript problem *or* just first-wins
undercounting. So the policy is measured, not assumed: every session is priced
three ways — keeping the FIRST usage bag per response, the LAST, and the per-field
MAX — and the report states plainly whether the three agree. Establishing this on
the corpus beats arguing it from the code.

Current status on 22 local transcripts: **0 divergent bags across 1,399 multi-line
response groups.** First / last / max produce identical totals, so the policy
cannot explain any delta found here. That is a property of these transcripts, not
a guarantee from Claude Code — which is exactly why the check runs every time
rather than once.

**Same-basis covariates.** Thinking tokens and output tokens are both summed over
the *deduped* bags. Summing thinking per-line against deduped output inflates the
ratio by the duplication factor and can push it past 100%, which reads as proof
that thinking is billed on top of output rather than inside it. It isn't; that was
a bug in the first draft of this script.

## Four outcomes

The verdict is classified, not eyeballed:

| | Condition | Reading |
|---|---|---|
| **A** | ledger ≈ statusline | JSONL is sound interactively. No wedge — archive it. |
| **B** | ledger under by a ~constant ratio | Systematic exclusion (thinking tokens, an unlogged call class). Confirm with a billed `claude -p` run with thinking on. |
| **C** | ledger under by a ratio that varies widely | Content-dependent, so no constant corrects it. The strongest result: no transcript-summing tool can be trusted. |
| **D** | ledger over statusline | Over-counting — a dedupe or double-pricing bug. Fix and re-run before reading anything else. |

## Logged per session

ledger total (×3 policies), statusline last + max, sample count, whether the
statusline value ever decreased (the cumulative-vs-delta test), response count,
multi-line and divergent group counts, user turns, tool-call count, output tokens,
thinking tokens, responses where thinking exceeded output, thinking on/off, fast
mode, models, Claude Code version.

## Known open questions this is meant to settle

- Is `cost.total_cost_usd` cumulative-to-date or a per-turn delta? Every sibling
  field (`total_duration_ms`, `total_lines_added`) is unambiguously cumulative, and
  the retained sample shows 212,044,007 ms — 58.9 hours — so cumulative is the
  strong prior. The report tests it directly by checking monotonicity across
  renders within a session.
- Does it fire every turn, or only when the statusline re-renders? The capture is
  per-render with timestamps, so the cadence is recoverable after the fact.
- Is `thinking_tokens` inside `output_tokens` or additive? Evidence so far says
  inside (no response has thinking ≥ output across 1,399 groups), but thinking runs
  31–40% of output on Opus 5 sessions here, so if that's wrong it is a 40% error,
  not a rounding one. One billed `claude -p` run with thinking on settles it.

## Accuracy floor

Claude Code emits a separate `ai-title` API call that is billed but carries no
usage bag anywhere in the transcript (~$0.000614/session, measured 2026-07-20).
No transcript-derived ledger can see it. Expect the statusline to sit fractionally
above the ledger even in outcome A.
