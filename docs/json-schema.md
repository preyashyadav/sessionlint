# `sessionlint --json` output schema

`sessionlint --json` (and `sessionlint --ci`) emit a single JSON object with a top-level
`schemaVersion`. Consumers should read `schemaVersion` and treat unknown minor versions as
forward-compatible.

## Versioning policy

- **Additive** change (new optional field) → **minor** bump (e.g. `1.0.0` → `1.1.0`).
- **Breaking** change (removed/renamed/retyped field) → **major** bump, with a one-major
  deprecation window announced in [CHANGELOG.md](../CHANGELOG.md).
- The schema version is independent of the npm package version.

## Current version: `1.0.0`

```jsonc
{
  "schemaVersion": "1.0.0",
  "sessionsAnalyzed": 3,          // number of top-level sessions read
  "totalFindings": 2,            // total findings across all flagged sessions
  "flaggedSessions": [
    {
      "sessionId": "9bb10a7c-...",
      "title": "Set up workspace",   // aiTitle if present, else null (control chars stripped)
      "turnCount": 6,
      "findings": [
        {
          "ruleId": "cache-nuke",         // current canonical rule ID
          "severity": "error",            // "error" | "warning" | "info"
          "fromTurnNumber": 5,
          "toTurnNumber": 6,
          "evidence": "Model switch ...",
          "costImpact": { "low": 5.72, "high": 7.72 },  // USD range; omitted if not quantifiable
          "assumptions": ["high: ...", "low: ..."]      // labeled bounds; present iff costImpact is
        }
      ],
      "cost": {
        "estimated": 188.36,                            // API-equivalent USD (not a subscription bill)
        "couldHaveBeen": { "low": 180.12, "high": 182.64 } // omitted entirely if no finding is quantified
      }
    }
  ]
}
```

## Field notes

- **All dollar figures are API-equivalent cost** — the pinned pricing table applied to observed
  token usage — not a subscription bill.
- **`costImpact` / `couldHaveBeen` are ranges or absent, never point estimates** (D-004). A
  renderer/consumer must handle their absence, not assume a value.
- **`severity: "info"`** marks a finding that reports an observation without asserting waste
  (e.g. a model switch after the cache TTL likely expired).
- **`ruleId`** is always the current canonical ID. Former IDs (aliases) are accepted on the
  `--suppress` input side but never emitted here.

## Exit codes (`--ci`)

`sessionlint --ci` prints this JSON to stdout and sets the process exit code:

- `0` — no finding met the fail threshold.
- `1` — at least one finding at or above `--fail-on <error|warning|info>` (default `error`).
- `2` — usage error (e.g. an invalid `--fail-on` value).
