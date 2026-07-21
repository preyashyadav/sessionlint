import { describe, expect, test } from "bun:test";
import { join } from "path";
import { loadSession } from "../adapters/claude-code/session";
import { detectMissingClearAtTopicBoundary } from "./missing-clear-at-topic-boundary";

const SYNTHETIC_DIR = join(import.meta.dir, "..", "..", "fixtures", "synthetic");

const AS_OF = new Date("2026-07-10");

describe("detectMissingClearAtTopicBoundary: true positive (synthetic/missing-clear.jsonl)", () => {
  test("large context, never compacted: fires one finding", async () => {
    const { session } = await loadSession(join(SYNTHETIC_DIR, "missing-clear.jsonl"));
    const findings = detectMissingClearAtTopicBoundary(session, AS_OF);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.ruleId).toBe("missing-clear-at-topic-boundary");
    expect(findings[0]?.evidence).toContain("802,000 tokens");
  });

  test("costImpact is a hand-computed, non-degenerate range with labeled assumptions", async () => {
    const { session } = await loadSession(join(SYNTHETIC_DIR, "missing-clear.jsonl"));
    const finding = detectMissingClearAtTopicBoundary(session, AS_OF)[0]!;

    // Hand-computed (opus-4-8: cacheRead $0.50/MTok). Turn contexts:
    //   t0 802,000 (crossing)  t1 850,000  t2 880,000  t3 910,000  t4 940,000
    // low  (only post-crossing growth, baseline 802,000):
    //      (48,000 + 78,000 + 108,000 + 138,000)/1e6 × 0.50 = 0.186
    // high (/clear counterfactual — everything carried from the crossing onward):
    //      4,382,000/1e6 × 0.50 = 2.191
    expect(finding.costImpact).toBeDefined();
    expect(finding.costImpact!.low).toBeCloseTo(0.186, 6);
    expect(finding.costImpact!.high).toBeCloseTo(2.191, 6);
    expect(finding.costImpact!.low).toBeLessThan(finding.costImpact!.high);
    expect(finding.assumptions?.join(" ")).toContain("/clear");
    // The high bound must be labeled as a ceiling, not presented as an expectation.
    expect(finding.assumptions?.join(" ")).toContain("usually false");
  });
});

describe("detectMissingClearAtTopicBoundary: true negative (not actionable)", () => {
  test("a crossing in the last turns of a session does not fire", async () => {
    const { session } = await loadSession(join(SYNTHETIC_DIR, "missing-clear.jsonl"));
    // Truncate so the crossing sits at the very end — advising /clear there is noise,
    // the session is already over. This was the real-history false positive:
    // "turns 5-6" flagged on a 6-turn session.
    const truncated = { ...session, turns: session.turns.slice(0, 2) };
    expect(detectMissingClearAtTopicBoundary(truncated, AS_OF)).toEqual([]);
  });
});

describe("detectMissingClearAtTopicBoundary: true negative", () => {
  test("minimal-session.jsonl (tiny context): zero findings", async () => {
    const { session } = await loadSession(join(SYNTHETIC_DIR, "minimal-session.jsonl"));
    expect(detectMissingClearAtTopicBoundary(session)).toEqual([]);
  });

  test("compaction.jsonl (large context, but compaction did happen): zero findings", async () => {
    const { session } = await loadSession(join(SYNTHETIC_DIR, "compaction.jsonl"));
    expect(detectMissingClearAtTopicBoundary(session)).toEqual([]);
  });
});
