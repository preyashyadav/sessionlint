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

```bash
curl -fsSL https://bun.com/install | bash && bunx sessionlint
```

That is the whole setup. **sessionlint runs on [Bun](https://bun.com), not Node** — the
first half of that line installs Bun if you don't have it. Plain `npx sessionlint` will
not work; use `bunx`.

No config, no account, no server. It reads Claude Code's transcripts from your own
disk — `~/.claude/projects`, or `$CLAUDE_CONFIG_DIR/projects` if you use a custom
config dir. If you run more than one Claude account, it tells you so instead of
silently reporting on one of them (`sessionlint doctor` lists every config root it
found; `--all-roots` reads them all).

**Want to help?** The rules are still heuristics until they're measured on more than
one person's history. See **[CONTRIBUTING-CORPUS.md](./CONTRIBUTING-CORPUS.md)** — it
takes about two minutes.

## What a report looks like

Excerpt of real output, run against this repo's synthetic test fixtures:

```
$ sessionlint

sessionlint · 2 sessions analyzed

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
  session  syntheti  5 turns
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ⚠ MISSING-CLEAR-AT-TOPIC-BOUNDARY turns 1–5                $0.19–$2.19
    Context grew to ~802,000 tokens and was never cleared or compacted
    for the rest of the session — consider /clear or /compact at a
    natural topic boundary.
    → sessionlint explain missing-clear-at-topic-boundary

  session cost: $2.71 API-equivalent · could plausibly have been ~$0.52–$2.52

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  2 findings across 2 flagged sessions · replay-audit with: sessionlint --verify
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Every finding names its rule, shows the evidence, and gives a $ range with labeled
assumptions. Findings are always suppressible (`--suppress <rule-id>`) — sessionlint
tells you what happened; it never overrules you.

## Commands

| Command | What it does |
|---|---|
| `sessionlint` | Lint your history; findings with $ ranges. `--json` / `--md`, `--dir <path>` to point elsewhere |
| `sessionlint --ci` | CI gate: versioned JSON to stdout, non-zero exit when a finding meets `--fail-on <error\|warning\|info>` (default `error`) |
| `sessionlint sessions` | List sessions: id, date, turns, API-equivalent cost estimate |
| `sessionlint explain [<rule>]` | What a rule detects, why it costs, how to fix it |
| `sessionlint doctor` | Environment check: where sessions are read from, how many found, pricing freshness |
| `sessionlint export --redact` | Write redacted copies of your sessions (prose/paths/secrets removed) so you can share history. `--out <dir>` |
| `sessionlint send2preyash` | Prepare a redacted contribution bundle + a prefilled mail draft. Nothing is sent automatically. `--last N`, `--since <date>`, `--to <addr>` |
| `sessionlint --all-roots` | Include every Claude config dir on this machine, not just the active one (`--add-root <path>` for a specific one) |
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
| `giant-file-read` | A single read pulling 1,000+ lines *into context* (offset-limited reads of big files don't count) |
| `missing-clear-at-topic-boundary` | Context grew huge and never got a `/clear` or `/compact` |
| `repeated-identical-prompt` | The same prompt retried verbatim — the first attempt's cost bought nothing |

Details per rule: `sessionlint explain <rule>` or [docs/rules/](./docs/rules/).

## Privacy & honesty

- **Local-only by default.** No server, no account, no telemetry, and no background
  network activity of any kind. sessionlint has no ability to transmit your history:
  there is no upload path in the code.
- **One opt-in sharing flow, driven entirely by you.** `sessionlint send2preyash`
  exists so people can donate history to the validation study. It writes a redacted
  file to your working directory and opens a draft in *your* mail client — you attach
  the file and press send. It shows you a full preview, including a real redacted line
  from your own data, and asks twice before writing anything. It cannot send on your
  behalf, and `--paranoid` refuses it outright.
- **Read-only by default.** Anything that spends money (`--verify`, `run`) shows a
  cost preview and requires explicit confirmation. `--paranoid` blocks
  SessionLint-owned API and webhook calls; it cannot sandbox commands you explicitly launch.
- **Ranges, not points.** Dollar math runs against a pinned, dated pricing table
  with a staleness warning (`sessionlint doctor` shows its age). Anything not
  measured exactly is a labeled assumption.

## Status

Young but real: dogfooded on the author's own history, with a published test suite
(567 tests). Two results are published as-is because honest uncertainty is the point:

- The replay-verified equivalence audit returned **0 of 5** sampled turns judged
  equivalent on a cheaper model (Wilson 95% CI 0–43%). There is currently **no
  evidence** that routing work to a cheaper model preserves output quality, and the
  tool does not claim otherwise.
- The cost ledger reconciles **exactly** against `claude -p --output-format json`'s own
  `total_cost_usd` — but only on headless runs. The interactive path has not been
  reconciled yet; `scripts/experiment/` exists to measure it, and contributions are
  what make that possible.

## Contributing your history to the validation study

The rules are still heuristics until their precision is measured on real, diverse
sessions. If you'd like to help, you can donate a **redacted** copy of your history:

```bash
sessionlint export --redact --dry-run   # preview: shows exactly what would be shared, writes nothing
sessionlint export --redact             # writes redacted session-NNN.jsonl + a MANIFEST.md receipt
```

The export removes prose, file contents, paths, filenames, secrets, and free-text
keys, and keeps only what the rules need (model names, timestamps, usage token
counts). It writes a `MANIFEST.md` receipt describing exactly what's included, and a
self-check flags any residual secret/email pattern. **sessionlint never transmits
anything** — you review the folder and share it privately yourself. Redaction is
best-effort; please open a couple of files and confirm you're comfortable before sending.

## Development

```bash
bun install
bun test
```

MIT © Preyash Yadav
