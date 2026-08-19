# Changelog

All notable changes to sessionlint are documented here. This project follows
[Semantic Versioning](https://semver.org): the `--json` output carries its own
`schemaVersion` (see [docs/json-schema.md](./docs/json-schema.md)), versioned
independently of the package.

## [Unreleased]

## [0.6.1] - 2026-08-19

### Fixed

- **Pricing table date now reflects when the rates were actually verified.** Every rate
  was re-checked against Anthropic's published pricing page on 2026-08-19, but the table
  still carried `retrievedAt: "2026-08-14"`, so `doctor` reported it as 5 days old when
  it was current. Cosmetic — no rate was wrong — but this project does not get to be
  loose about provenance dates.

### Added

- **Retired models priced** (Opus 4.1, Opus 4, Sonnet 4, Haiku 3.5). Transcripts outlive
  model availability: a session recorded months ago was genuinely billed at those rates,
  and reporting "unknown pricing" for it was a gap, not caution.
- README now carries a step-by-step **"Trying it out (and sending me a report)"** walk-
  through, so a first-time user can go from install to useful feedback without reading
  the rest of the page. It asks for a plain-English report before it asks for any data.


## [0.6.0] - 2026-08-19

**If you use Claude Code with more than one account, every previous version silently
reported on one of them.** And from 2026-09-01, every previous version would have
priced Sonnet 5 50% too high. Both are fixed here.

### Fixed

- **Sonnet 5 would have been priced at a rate that will never exist.** 0.5.0 shipped
  `effectiveUntil: "2026-08-31"` with a `postIntroRate` of $3/$15, so on 2026-09-01 it
  would have automatically switched every Sonnet 5 session to a 50%-higher rate.
  Anthropic cancelled that increase — $2/$10 is now the standard price. The step-up is
  removed and the whole table re-verified against the published pricing page on
  2026-08-19. See D-009.
- **Sessions in other Claude config dirs were silently ignored.** sessionlint read one
  projects root and said nothing about the rest; on a two-account machine that meant
  reporting on 7 of 33 sessions with no warning. `doctor` now lists every config root
  it found and marks which are scanned, the main report warns when transcripts are
  being left out, and `--all-roots` / `--add-root <path>` include them. A confident
  total that omits two thirds of the data is the worst failure this tool can have.

### Added

- **`sessionlint send2preyash`** (alias `contribute`) — prepares a redacted
  contribution bundle for the validation corpus and opens a prefilled draft in your own
  mail client. **Nothing is transmitted:** there is no upload path in the codebase; you
  attach the file and press send. Two confirmations, a full preview including a real
  redacted line from your own data, and a self-check that refuses to write the bundle if
  any residual secret, email, path, URL, or identifier pattern survives. `--paranoid`
  refuses the command outright.
- **Pricing coverage for metered-era billing.** Fast mode (Opus 5 / Opus 4.8, $10/$50,
  a replacement rate rather than a multiplier) and the `inference_geo: "us"` 1.1x data
  residency premium are now priced per API response, read from each response's own
  usage bag. Opus 4.5, Sonnet 4.5 added to the table.
- **`scripts/experiment/`** is now published — a statusline capture script and a
  reconciler that compares a transcript-derived ledger against Claude Code's own
  `cost.total_cost_usd`. The exactness claim in this project has only ever been
  verified on headless `claude -p` runs; this is how the interactive path gets measured.
  The capture script logs an explicit allowlist of accounting fields and no prompt text,
  paths, or tool arguments.
- **[CONTRIBUTING-CORPUS.md](./CONTRIBUTING-CORPUS.md)** — contributor onboarding, with
  a plain-English privacy section.
- Compiled binaries for darwin-arm64/x64, linux-x64/arm64, and windows-x64 via
  `bun build --compile`, for people who don't want to install Bun.

### Changed

- README now leads with the exact install command and states plainly that `npx` will not
  work — sessionlint needs Bun. The privacy section describes the new opt-in sharing
  flow instead of claiming a blanket "nothing ever leaves your machine".
- The bundle redactor goes beyond `export --redact`: session UUIDs (under any key
  spelling), git branch names, MCP server names, and project directory names are all
  pseudonymized. Every one of those was found by reading a real produced bundle by hand
  — the automated self-check passed all of them first.


## [0.5.0] - 2026-07-20

**Every cost figure reported by earlier versions was overstated — typically by
about 2.2x, and by as much as 3.3x. If you have acted on a number from 0.4.0 or
earlier, re-run it.** Details below.

### Fixed

- **Cost was inflated ~2.2x by counting each API response once per content block.**
  Claude Code writes one JSONL line per content block (a `thinking` block, each
  `tool_use` block), and every one of those lines repeats the *full, identical*
  usage bag for the single response that produced them. sessionlint summed all of
  them. Measured across 39 real local transcripts: $3,609 reported vs $1,622
  actual — an overall 2.23x, ranging 1.77x-3.34x per session depending on how
  tool-heavy the session was (so it was not a constant users could correct for).
  Usage is now deduplicated per API response (`message.id`, falling back to
  `requestId`). Verified against ground truth: sessionlint's figure for a real
  session now matches `claude -p --output-format json`'s own `total_cost_usd`
  exactly, to the cent and beyond.
  *Affects every dollar figure: the report, `sessions`, all rule cost ranges,
  `--verify` savings, and — behaviourally — `loop`/`run` budgets, which were
  tripping roughly 2.2x early.*
- **`giant-file-read` fired on file size instead of what was actually read**, and
  overstated its cost by **51x** on real history. It keyed on the tool result's
  `totalLines` (how big the file is on disk) rather than `numLines` (how much this
  read pulled into context), so an offset-limited Read of 30 lines from a
  10,437-line file was reported as a 10,437-line read — flagging the user for doing
  exactly what the rule recommends. It now triggers on lines actually loaded, and
  estimates tokens from the tool result's real content (~4 chars/token) instead of
  a flat ~10-tokens-per-line guess, prorated to the over-threshold share.
- **An expired introductory price would have been billed forever.** `introRateExpired`
  was computed but never acted on. Sonnet 5's intro rate lapses 2026-08-31, after
  which every Sonnet session would have been understated by 33%, silently. Rates now
  switch to the published standard price automatically at the boundary
  (`postIntroRate`), and each turn is priced at the rate in effect *when it ran* — so
  historical sessions keep their historical pricing instead of being repriced at
  today's rates. When an intro rate lapses with no published replacement, the old rate
  is kept and explicitly flagged rather than a replacement being invented.
- **`sessionlint --version` reported `0.1.0`** regardless of the installed version
  (the constant in `index.ts` had drifted from `package.json`).
- **`repeated-identical-prompt` fired on harness-injected text.** Slash-command
  echoes (`<local-command-caveat>`, `<command-name>`, ...) and `<system-reminder>`
  blocks appear in the transcript looking like user messages; two identical ones in
  a row are the harness being consistent, not a human retrying.
- **`cache-nuke` had no noise floor** and would emit a finding for a switch that
  reprocessed as little as ~1 token — printing a finding in order to report that
  nothing happened. Now requires at least 1,024 fresh input tokens (the smallest
  cacheable prefix on any current model).
- **`missing-clear-at-topic-boundary` fired on almost every substantial session.**
  Its flat 500,000-token threshold was half of a 1M context window. It now triggers
  at 75% of the *model's own* window (750k on 1M models, 150k on Haiku) and stays
  quiet when the crossing lands in the last few turns, where advising a `/clear` is
  not actionable — it previously flagged "turns 5-6" of a 6-turn session. Its high
  cost bound is now explicitly labeled a ceiling that assumes none of the carried
  context was needed afterwards (usually false); the low bound is the realistic figure.

### Added

- `scripts/gen-rule-docs.ts` regenerates `docs/rules/*.md` from `src/report/rule-docs.ts`.
  Those files always claimed to be generated, but no generator was ever committed, so
  they were hand-maintained and had drifted from the implementation. `--check` fails
  without writing, for CI.
- Fixture `synthetic/multi-block-response.jsonl`: one API response spread across three
  JSONL lines. Every prior synthetic fixture was single-API-call-per-turn, which is
  precisely why the usage double-count survived the whole test suite.

### Known limitations

- Claude Code makes a separate title-generation API call (`ai-title` entries) that is
  billed but carries no usage data in the transcript. sessionlint cannot see it, so
  reported cost runs ~$0.0006 low per session. That is roughly 1% of a five-cent
  session and negligible on any real one, but it is a floor on achievable accuracy.

## [0.4.0] - 2026-07-19

### Added
- `sessionlint export --redact`: writes redacted copies of your session transcripts
  to a directory so you can share history (e.g. donate to a validation corpus).
  Prose, file contents, paths, filenames, secrets, and free-text object keys are
  removed; model names, tool names, timestamps, entry types, and usage token counts
  are preserved (so the output is still analyzable). Output files are flattened to
  `session-NNN.jsonl` (never a source-derived name), and a post-redaction self-check
  flags any residual secret/email pattern. `--redact` is mandatory — there is no raw
  export. Redaction is best-effort; the output must be reviewed before sharing.
  Each export also writes a `MANIFEST.md` receipt (what's included, redacted-vs-preserved
  fields, self-check result, a sample redacted line, and consent / how-to-share guidance).
  `--dry-run` shows the summary and a sample redacted line without writing anything.
  sessionlint never transmits anything — you share the folder yourself.

## [0.3.0] - 2026-07-19

### Added
- `--ci` mode: non-interactive lint that exits non-zero when findings meet a
  severity threshold (`--fail-on error|warning|info`, default `error`), for use
  as a CI gate.
- Versioned machine-readable output: `sessionlint --json` now includes a
  top-level `schemaVersion` field. Schema documented in `docs/json-schema.md`.
- Rule-ID aliasing: renamed rules can keep their old `--suppress` IDs working
  via a rule's `aliases`, so a rename never silently breaks a user's suppress list.
- Parser hardening: a per-line size cap (skipped and counted separately from
  JSON parse errors, never allocated into a parse), plus a fuzz test covering
  malformed/hostile JSONL input.

## [0.2.0] - 2026-07-19

First provenance-backed release, published from CI via npm Trusted Publishing.

### Changed (claim integrity & command safety — see the remediation work)
- `cache-nuke` attribution is now TTL-aware: a model switch after an idle gap
  longer than the cache TTL is reported informationally with no avoidable-cost
  claim; severity is derived from the cost range (a net-saving switch is never
  labeled an error).
- Added an `info` severity for findings that report without asserting waste.
- `--success-check` / `--test-command` use explicit argv parsing and reject
  shell operators instead of silently mis-splitting on whitespace.
- Transcript-derived report text is sanitized of ANSI/control sequences.
- `--paranoid` narrowed to the accurate guarantee: it blocks SessionLint-owned
  API and webhook egress (it is not an OS sandbox for wrapped child processes).
- Cost figures are labeled **API-equivalent** (not a subscription bill).

### Repository
- Public repo trimmed to the usable product plus the published test suite
  (synthetic fixtures only); development tooling, real-history-derived fixtures,
  and internal planning docs are kept local.

## [0.1.0] - 2026-07-18 (deprecated)

Predates the security & claim-integrity remediation. Deprecated on npm; use
`>=0.2.0`.

## [0.0.1] (deprecated)

Pre-release placeholder. Deprecated on npm.
