# Security Policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately via GitHub's **"Report a
vulnerability"** (Security → Advisories) on this repository, rather than opening
a public issue. Include reproduction steps and the sessionlint version
(`sessionlint version`). We aim to acknowledge reports within a few days.

## Threat model

sessionlint reads local Claude Code session transcripts, whose content is
**attacker-influenceable** — a malicious repository, a poisoned tool result, or
a prompt-injected assistant turn can write arbitrary strings into the JSONL that
sessionlint later parses. The tool is designed around that assumption:

- **No shell interpolation of transcript content.** Every subprocess is spawned
  with an argument array (never a shell string), so transcript text can never be
  interpreted as a command. User-supplied command flags (`--success-check`,
  `--test-command`) are argv-parsed and reject shell operators; opting into shell
  semantics requires an explicit `sh -c`.
- **Terminal-output sanitization.** Transcript-derived text rendered to the
  terminal is stripped of ANSI/control sequences to prevent output injection.
- **Read-only by default.** The default lint path performs no network I/O and
  writes nothing outside stdout. Effects are opt-in and gated:
  `--verify`/`run` make billed API calls behind a cost preview + confirmation;
  `watch --webhook` posts only when configured. `--paranoid` blocks all
  SessionLint-owned network egress (it is **not** an OS sandbox — a child process
  launched via `sessionlint loop -- <cmd>` can still perform its own I/O; confine
  those with a container/firewall if needed).
- **Parser robustness.** Malformed JSONL lines are skipped and counted, never
  fatal; oversized lines are capped and skipped rather than allocated.

## Privacy

sessionlint is local-first: transcripts never leave your machine on the default
path. The published package and repository contain **no** real session data —
the test suite runs on hand-authored synthetic fixtures only.

## Supported versions

Security fixes are made against the latest published version. See
[CHANGELOG.md](./CHANGELOG.md). Versions `0.0.1` and `0.1.0` are deprecated on
npm; use `>=0.2.0`.
