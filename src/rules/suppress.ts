/** Pure filter for `--suppress <id>` (the CLI owns argv parsing; this owns the filtering). */

import type { Finding, Rule } from "./types";

/** Maps every alias (former rule ID) to the rule's current canonical ID. Canonical IDs map to
 * themselves implicitly (resolve() falls back to the input). Built once from the rule set. */
export function buildAliasIndex(rules: Rule[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const rule of rules) {
    for (const alias of rule.aliases ?? []) index.set(alias, rule.id);
  }
  return index;
}

/** Filters findings by suppressed rule IDs, resolving aliases on both sides so suppressing by
 * either a rule's current ID or any of its former IDs works. */
export function applySuppression(
  findings: Finding[],
  suppressedRuleIds: Iterable<string>,
  aliasIndex?: Map<string, string>
): Finding[] {
  const resolve = (id: string): string => aliasIndex?.get(id) ?? id;
  const suppressed = new Set([...suppressedRuleIds].map(resolve));
  if (suppressed.size === 0) return findings;
  return findings.filter((f) => !suppressed.has(resolve(f.ruleId)));
}
