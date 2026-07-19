export { detectCacheNukes, cacheNukeRule, CACHE_NUKE_RULE_ID } from "./cache-nuke";
export { detectLateCompactions, lateCompactionRule, LATE_COMPACTION_RULE_ID } from "./late-compaction";
export { detectGiantFileReads, giantFileReadRule, GIANT_FILE_READ_RULE_ID } from "./giant-file-read";
export {
  detectRepeatedIdenticalPrompts,
  repeatedIdenticalPromptRule,
  REPEATED_IDENTICAL_PROMPT_RULE_ID,
} from "./repeated-identical-prompt";
export {
  detectMissingClearAtTopicBoundary,
  missingClearAtTopicBoundaryRule,
  MISSING_CLEAR_RULE_ID,
} from "./missing-clear-at-topic-boundary";
export { applySuppression, buildAliasIndex } from "./suppress";
export type { Rule, Finding, CostImpactRange } from "./types";

import { cacheNukeRule } from "./cache-nuke";
import { lateCompactionRule } from "./late-compaction";
import { giantFileReadRule } from "./giant-file-read";
import { repeatedIdenticalPromptRule } from "./repeated-identical-prompt";
import { missingClearAtTopicBoundaryRule } from "./missing-clear-at-topic-boundary";
import type { Rule } from "./types";

/** All rules currently implemented (Phase 1, Tasks 3-4). */
export const ALL_RULES: Rule[] = [
  cacheNukeRule,
  lateCompactionRule,
  giantFileReadRule,
  repeatedIdenticalPromptRule,
  missingClearAtTopicBoundaryRule,
];
