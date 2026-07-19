/**
 * Model-string shape validation. Deliberately NOT prefix-matched on
 * "claude-" — a genuinely new future model name must still pass (D-004:
 * never manufacture false precision via a hardcoded allowlist). This
 * heuristic exists to defeat corrupted/placeholder values — concretely,
 * a real fixture (fixtures/917c012e-2980-4a86-bf24-5cb62df8a942.jsonl:90)
 * has a model field mangled into filler prose by a sanitizer bug — real
 * Anthropic model slugs never contain whitespace, so that alone is enough
 * to reject it without narrowing what a valid future model name can be.
 *
 * Also rejects `<...>`-wrapped meta-markers such as `<synthetic>` — a real,
 * legitimate value Claude Code writes on tool-result-stitching turns (see
 * MASTER.md §9), but not a real billable model. Found by running the CLI
 * against real local history: without this exclusion, cache-nuke fired
 * nonsense "switches" to/from `<synthetic>` and cost/context-size evidence
 * came out zeroed (synthetic turns carry no real usage).
 */

export function isValidModelShape(raw: string | null | undefined): raw is string {
  return (
    typeof raw === "string" &&
    raw.length > 0 &&
    raw.length <= 64 &&
    !/\s/.test(raw) &&
    !(raw.startsWith("<") && raw.endsWith(">"))
  );
}
