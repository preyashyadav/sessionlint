/** Pure filter for `--suppress <id>` (Task 5 owns argv parsing; this owns the filtering). */

import type { Finding } from "./types";

export function applySuppression(findings: Finding[], suppressedRuleIds: Iterable<string>): Finding[] {
  const suppressed = new Set(suppressedRuleIds);
  if (suppressed.size === 0) return findings;
  return findings.filter((f) => !suppressed.has(f.ruleId));
}
