# Supported Claude Code transcript schemas

sessionlint reads Claude Code's local session transcripts (`~/.claude/projects/**/*.jsonl`,
or under `$CLAUDE_CONFIG_DIR`). That format is **not a published, versioned contract** — it is
an implementation detail of Claude Code that can change between releases. sessionlint is built
to degrade gracefully rather than crash or silently produce wrong answers when it sees a shape
it doesn't recognize (capability detection, C-1).

## Validated against

The parser and rules were validated against a fixture corpus of real (sanitized) transcripts
spanning these Claude Code versions:

- **2.1.179, 2.1.183, 2.1.186, 2.1.195, 2.1.198, 2.1.199, 2.1.201, 2.1.202** — the sanitized
  fixture corpus (8 versions across 3 projects).
- Additionally exercised against live local history on **2.1.207–2.1.214** during development.

The published test suite runs on hand-authored **synthetic** fixtures that reproduce the schema
shapes observed across those versions (usage token fields incl. 5m/1h cache-creation breakdown,
`promptId` turn grouping, `parentUuid` fallback grouping, `compactMetadata` auto-compaction,
corrupted/`<synthetic>` model entries, unknown entry types).

## How unknown shapes are handled

- **Malformed JSONL line** → skipped and counted (`parseErrorCount`), never fatal.
- **Oversized line** → skipped and counted separately, never allocated into a parse.
- **Unknown entry `type`** → retained and counted (`unknownTypeCounts`), never dropped silently.
- **Unrecognized/unshaped model value** (e.g. `<synthetic>`, a corrupted string) → treated as
  an invalid model (`modelValid: false`), excluded from model-switch and cost-attribution signals.
- **Missing usage fields** → cost resolves to a named gap (`pricingKnown: false`), never a silent $0.
- **Unknown model in the pricing table** → `null` rate, surfaced as unknown-pricing, never guessed.

`sessionlint doctor` reports the sessions root, how many transcripts were found, and the newest
transcript age, so you can confirm sessionlint is reading the right place.

## If a new Claude Code version breaks something

The transcript schema is a monitored dependency, not a guaranteed one. If a Claude Code update
changes the shape in a way sessionlint mis-reads, please
[report it](https://github.com/preyashyadav/sessionlint/issues) with your `sessionlint version`
and `claude --version`. Roadmap item: a golden-transcript CI job that parses transcripts from the
latest Claude Code release on a schedule, converting schema drift from a silent risk into a
same-day signal.
