# sessionlint

**ccusage shows the bill. sessionlint shows patterns behind it — and helps agent loops land.**

sessionlint reads your local Claude Code session history and identifies patterns
that often drive API-equivalent cost. It reports honest ranges with labeled
assumptions rather than pretending every heuristic is causal, then helps future
sessions avoid repeated waste.

Three layers, all in one CLI:

- **Audit** — a read-only linter over your existing transcripts, with a
  replay-verified `--verify` mode.
- **Live session** — a statusline burn gauge, per-session budgets, and cheaper-model
  delegation for subagents.
- **Autonomous runs** — budgets, a convergence watchdog, and morning-after reports
  for Ralph/GSD-style loops, headless runs, and CI.

## Install

Requires [Bun](https://bun.com):

```bash
curl -fsSL https://bun.com/install | bash   # if you don't have Bun
bunx sessionlint                            # that's the whole setup
```

No config, no account, no server. It reads Claude Code's transcripts from your own
disk — `~/.claude/projects`, or `$CLAUDE_CONFIG_DIR/projects` if you use a custom
config dir (it even detects the case where Claude Code misplaced them).

## What a report looks like

Excerpt of real output, run against this repo's synthetic test fixtures:

```
$ sessionlint

sessionlint · 3 sessions analyzed

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  session  syntheti  2 turns
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ⚠ CACHE-NUKE             turns 1–2                -$0.03–$0.01
    Model switch claude-opus-4-8 -> claude-sonnet-5 was followed by
    ~8,500 tokens billed as fresh input. The switch occurred within the
    default five-minute cache TTL; the cost range spans both cache-hit
    and cache-cold counterfactuals.
    → sessionlint explain cache-nuke

  session cost: $0.04 API-equivalent · could plausibly have been ~$0.03–$0.04

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  session  syntheti  2 turns
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ⚠ MISSING-CLEAR-AT-TOPIC-BOUNDARY turns 1–2                $0.03–$0.64
    Context grew to ~612,000 tokens and was never cleared or compacted
    for the rest of the session — consider /clear or /compact at a
    natural topic boundary.
    → sessionlint explain missing-clear-at-topic-boundary

  session cost: $0.83 API-equivalent · could plausibly have been ~$0.19–$0.80

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  3 findings across 3 flagged sessions · replay-audit with: sessionlint --verify
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Every finding names its rule, shows the evidence, and gives a $ range with labeled
assumptions. Findings are always suppressible (`--suppress <rule-id>`) — sessionlint
tells you what happened; it never overrules you.

## Commands

| Command | What it does |
|---|---|
| `sessionlint` | Lint your history; findings with $ ranges. `--json` / `--md` for CI, `--dir <path>` to point elsewhere |
| `sessionlint sessions` | List sessions: id, date, turns, API-equivalent cost estimate |
| `sessionlint explain [<rule>]` | What a rule detects, why it costs, how to fix it |
| `sessionlint doctor` | Environment check: where sessions are read from, how many found, pricing freshness |
| `sessionlint --verify` | Replay-audit findings with real, billed API calls — cost preview + confirmation first |
| `sessionlint statusline` | Burn gauge for Claude Code's `statusLine.command` |
| `sessionlint budget set <usd>` | Per-session $ budget for the statusline sentinel (`status` / `off`) |
| `sessionlint auto-delegate <model>` | Route subagents to a cheaper model from the next session |
| `sessionlint watch` | Supervise an in-session loop (ralph-loop, GSD) by tailing transcripts — read-only unless you opt in |
| `sessionlint loop -- <cmd>` | Wrap an external loop with budgets + convergence watchdog |
| `sessionlint run --prompt <text>` | Budgeted, model-laddered headless `claude -p` run |
| `sessionlint report` | Morning-after summary of the last loop run |
| `sessionlint help` | Full flag reference |

## The rules

| Rule | What it catches |
|---|---|
| `cache-nuke` | Fresh-input processing after a model switch, with TTL-aware attribution and dynamic severity |
| `late-compaction` | Context filled up until auto-compaction hit, after carrying the excess for many turns |
| `giant-file-read` | A 1,000+ line file read whole into context instead of Grep/offset reads |
| `missing-clear-at-topic-boundary` | Context grew huge and never got a `/clear` or `/compact` |
| `repeated-identical-prompt` | The same prompt retried verbatim — the first attempt's cost bought nothing |

Details per rule: `sessionlint explain <rule>` or [docs/rules/](./docs/rules/).

## Privacy & honesty

- **Local-only.** Your transcripts never leave your machine. No server, no account,
  no telemetry.
- **Read-only by default.** Anything that spends money (`--verify`, `run`) shows a
  cost preview and requires explicit confirmation. `--paranoid` blocks
  SessionLint-owned API and webhook calls; it cannot sandbox commands you explicitly launch.
- **Ranges, not points.** Dollar math runs against a pinned, dated pricing table
  with a staleness warning (`sessionlint doctor` shows its age). Anything not
  measured exactly is a labeled assumption.

## Status

Young but real: 495 passing tests, dogfooded on the author's own history. The
first replay-verified equivalence audit was inconclusive (0/5 sampled turns matched
on a cheaper model, far too small a sample for a general conclusion) and is
published as-is because honest uncertainty is the point.

## Development

```bash
bun install
bun test
```

MIT © Preyash Yadav
