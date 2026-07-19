import { describe, expect, test } from "bun:test";
import { join } from "path";
import { loadSession } from "../adapters/claude-code/session";
import { detectLateCompactions } from "./late-compaction";
import type { Session, Turn } from "../adapters/claude-code/types";

const SYNTHETIC_DIR = join(import.meta.dir, "..", "..", "fixtures", "synthetic");

const AS_OF = new Date("2026-07-10");

describe("detectLateCompactions: true positive (synthetic/compaction.jsonl)", () => {
  test("fires one finding with the real compactMetadata shape", async () => {
    const { session } = await loadSession(join(SYNTHETIC_DIR, "compaction.jsonl"));
    const findings = detectLateCompactions(session, AS_OF);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.ruleId).toBe("late-compaction");
    expect(findings[0]?.evidence).toContain("935,020 tokens");
    expect(findings[0]?.evidence).toContain("922,429 tokens");
    expect(findings[0]?.evidence).toContain("12,591 tokens preserved");
  });

  test("costImpact is a hand-computed, non-degenerate range with labeled assumptions", async () => {
    const { session } = await loadSession(join(SYNTHETIC_DIR, "compaction.jsonl"));
    const finding = detectLateCompactions(session, AS_OF)[0]!;

    // Hand-computed (opus-4-8: input $5/MTok → cacheRead $0.50, write5m $6.25):
    // window = the compaction turn itself; ctx = 5000+900000+30000 = 935,000;
    // excess = 935,000 − 12,591 (postTokens) = 922,409
    // low  = 922,409/1e6 × 0.50 = 0.4612045
    // writeShare = (922,409/935,000) × (30,000/1e6 × 6.25 = 0.1875) = 0.1849751
    // high = 0.4612045 + 0.1849751 = 0.6461796
    expect(finding.costImpact).toBeDefined();
    expect(finding.costImpact!.low).toBeCloseTo(0.4612045, 5);
    expect(finding.costImpact!.high).toBeCloseTo(0.6461796, 5);
    expect(finding.costImpact!.low).toBeLessThan(finding.costImpact!.high);
    expect(finding.assumptions?.length).toBeGreaterThan(0);
    expect(finding.assumptions?.join(" ")).toContain("12,591");
  });
});

describe("detectLateCompactions: true negative (no compaction entry)", () => {
  test("minimal-session.jsonl: zero findings", async () => {
    const { session } = await loadSession(join(SYNTHETIC_DIR, "minimal-session.jsonl"));
    expect(detectLateCompactions(session)).toEqual([]);
  });
});

describe("detectLateCompactions: manual trigger is never flagged", () => {
  function makeTurnWithCompaction(trigger: string): Turn {
    return {
      turnId: "t1",
      turnIdSource: "prompt-id",
      startedAt: new Date(),
      entries: [
        {
          raw: {
            type: "system",
            compactMetadata: { trigger, preTokens: 100_000, postTokens: 5_000, cumulativeDroppedTokens: 95_000 },
          },
          lineNumber: 1,
          uuid: "sys1",
          parentUuid: null,
          timestamp: new Date(),
          kind: "meta",
        },
      ],
      model: null,
      modelRaw: null,
      modelValid: false,
      usage: null,
      content: { hasText: false, toolUseNames: [], toolResultCount: 0 },
    };
  }

  test("trigger: manual produces zero findings", () => {
    const session: Session = {
      sessionId: "s1",
      filePath: "/fake.jsonl",
      ccVersions: [],
      turns: [makeTurnWithCompaction("manual")],
      modelSwitches: [],
      entryCount: 1,
      unknownTypeCounts: {},
      parseErrorCount: 0,
    };
    expect(detectLateCompactions(session)).toEqual([]);
  });

  test("trigger: auto produces one finding (regression guard)", () => {
    const session: Session = {
      sessionId: "s1",
      filePath: "/fake.jsonl",
      ccVersions: [],
      turns: [makeTurnWithCompaction("auto")],
      modelSwitches: [],
      entryCount: 1,
      unknownTypeCounts: {},
      parseErrorCount: 0,
    };
    const findings = detectLateCompactions(session);
    expect(findings).toHaveLength(1);
    // No usage bags / no priced model in the window ⇒ costImpact omitted entirely,
    // never a zero-width or guessed range (D-004).
    expect(findings[0]!.costImpact).toBeUndefined();
    expect(findings[0]!.assumptions).toBeUndefined();
  });
});
