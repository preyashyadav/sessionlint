# Changelog

All notable changes to sessionlint are documented here. This project follows
[Semantic Versioning](https://semver.org): the `--json` output carries its own
`schemaVersion` (see [docs/json-schema.md](./docs/json-schema.md)), versioned
independently of the package.

## [Unreleased]

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
