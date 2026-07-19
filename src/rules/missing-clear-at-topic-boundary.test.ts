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
    expect(findings[0]?.evidence).toContain("612,000 tokens");
  });

  test("costImpact is a hand-computed, non-degenerate range with labeled assumptions", async () => {
    const { session } = await loadSession(join(SYNTHETIC_DIR, "missing-clear.jsonl"));
    const finding = detectMissingClearAtTopicBoundary(session, AS_OF)[0]!;

    // Hand-computed (opus-4-8: cacheRead $0.50/MTok). Crossing at turn 1 (ctx 612,000);
    // turn 2 ctx = 3000+650000+15000 = 668,000.
    // low  (only post-crossing growth): (668,000 − 612,000)/1e6 × 0.50 = 0.028
    // high (/clear counterfactual — everything carried from the crossing onward):
    //      (612,000 + 668,000)/1e6 × 0.50 = 0.64
    expect(finding.costImpact).toBeDefined();
    expect(finding.costImpact!.low).toBeCloseTo(0.028, 6);
    expect(finding.costImpact!.high).toBeCloseTo(0.64, 6);
    expect(finding.costImpact!.low).toBeLessThan(finding.costImpact!.high);
    expect(finding.assumptions?.join(" ")).toContain("/clear");
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
