import { describe, expect, test } from "bun:test";
import { join } from "path";
import { loadSession } from "../adapters/claude-code/session";
import { detectGiantFileReads, GIANT_FILE_READ_LINE_THRESHOLD } from "./giant-file-read";
import type { Session, Turn } from "../adapters/claude-code/types";

const SYNTHETIC_DIR = join(import.meta.dir, "..", "..", "fixtures", "synthetic");

const AS_OF = new Date("2026-07-10");

describe("detectGiantFileReads: true positive (synthetic/giant-file-read.jsonl)", () => {
  test("fires one finding naming the line count", async () => {
    const { session } = await loadSession(join(SYNTHETIC_DIR, "giant-file-read.jsonl"));
    const findings = detectGiantFileReads(session, AS_OF);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.ruleId).toBe("giant-file-read");
    expect(findings[0]?.evidence).toContain("1,500 lines");
    expect(findings[0]?.evidence).toContain(`${GIANT_FILE_READ_LINE_THRESHOLD.toLocaleString()}-line threshold`);
  });

  test("costImpact is a hand-computed, non-degenerate range with the tokens-per-line ASSUMPTION labeled", async () => {
    const { session } = await loadSession(join(SYNTHETIC_DIR, "giant-file-read.jsonl"));
    const finding = detectGiantFileReads(session, AS_OF)[0]!;

    // Hand-computed (sonnet-5 intro: input $2/MTok → cacheWrite5m $2.50). One read of
    // 1,500 lines in the session's only turn (turnsAfter = 0):
    // avoidableTokens = (1500 − 1000) × 10 = 5,000
    // low  = 5,000/1e6 × 2.00 = 0.01   (billed once at input rate)
    // high = 5,000/1e6 × 2.50 = 0.0125 (cache-written once; no later turns to carry into)
    expect(finding.costImpact).toBeDefined();
    expect(finding.costImpact!.low).toBeCloseTo(0.01, 8);
    expect(finding.costImpact!.high).toBeCloseTo(0.0125, 8);
    expect(finding.costImpact!.low).toBeLessThan(finding.costImpact!.high);
    expect(finding.assumptions?.join(" ")).toContain("tokens per line");
  });
});

describe("detectGiantFileReads: true negative", () => {
  test("minimal-session.jsonl (no tool use at all): zero findings", async () => {
    const { session } = await loadSession(join(SYNTHETIC_DIR, "minimal-session.jsonl"));
    expect(detectGiantFileReads(session)).toEqual([]);
  });

  test("missing-prompt-id.jsonl (has a Read tool_use but no toolUseResult.file metadata): zero findings", async () => {
    const { session } = await loadSession(join(SYNTHETIC_DIR, "missing-prompt-id.jsonl"));
    expect(detectGiantFileReads(session)).toEqual([]);
  });
});

describe("detectGiantFileReads: dedup within a turn (verified against real history)", () => {
  function entryWithGiantRead(uuid: string, totalLines: number) {
    return {
      raw: { type: "user", toolUseResult: { file: { totalLines } } },
      lineNumber: 1,
      uuid,
      parentUuid: null,
      timestamp: new Date(),
      kind: "tool-result" as const,
    };
  }

  test("the same giant file read multiple times in one turn produces ONE finding with a count note", () => {
    const turn: Turn = {
      turnId: "t1",
      turnIdSource: "prompt-id",
      startedAt: new Date(),
      entries: [entryWithGiantRead("e1", 1500), entryWithGiantRead("e2", 1500), entryWithGiantRead("e3", 1800)],
      model: null,
      modelRaw: null,
      modelValid: false,
      usage: null,
      content: { hasText: false, toolUseNames: [], toolResultCount: 3 },
    };
    const session: Session = {
      sessionId: "s1",
      filePath: "/fake.jsonl",
      ccVersions: [],
      turns: [turn],
      modelSwitches: [],
      entryCount: 3,
      unknownTypeCounts: {},
      parseErrorCount: 0,
    };

    const findings = detectGiantFileReads(session);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.evidence).toContain("1,800 lines"); // the max of the three reads
    expect(findings[0]?.evidence).toContain("read 3 times in this turn");
    // No priced model anywhere in the session ⇒ costImpact omitted, never guessed (D-004).
    expect(findings[0]!.costImpact).toBeUndefined();
  });
});
