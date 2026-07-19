/** Which cheaper model to test as a substitute for a given premium model. */
const DOWNGRADE_TARGETS: Record<string, string> = {
  "claude-opus-4-8": "claude-sonnet-5",
  "claude-opus-4-7": "claude-sonnet-5",
  "claude-opus-4-6": "claude-sonnet-5",
  "claude-fable-5": "claude-opus-4-8",
  "claude-mythos-5": "claude-opus-4-8",
};

export function downgradeModelFor(originalModel: string): string | null {
  const exact = DOWNGRADE_TARGETS[originalModel];
  if (exact) return exact;
  if (originalModel.startsWith("claude-opus")) return "claude-sonnet-5";
  if (originalModel.startsWith("claude-fable") || originalModel.startsWith("claude-mythos")) return "claude-opus-4-8";
  return null;
}
