import { describe, expect, test } from "bun:test";
import { join } from "path";
import { loadSession } from "../adapters/claude-code/session";
import { detectRepeatedIdenticalPrompts } from "./repeated-identical-prompt";

const SYNTHETIC_DIR = join(import.meta.dir, "..", "..", "fixtures", "synthetic");

const AS_OF = new Date("2026-07-10");

describe("detectRepeatedIdenticalPrompts: true positive", () => {
  test("synthetic/repeated-identical-prompt.jsonl: fires one finding", async () => {
    const { session } = await loadSession(join(SYNTHETIC_DIR, "repeated-identical-prompt.jsonl"));
    const findings = detectRepeatedIdenticalPrompts(session, AS_OF);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.ruleId).toBe("repeated-identical-prompt");
    expect(findings[0]?.evidence).toContain("Fix the bug in auth.ts");
  });

  test("costImpact bounds the discarded first attempt's ACTUAL billed cost", async () => {
    const { session } = await loadSession(join(SYNTHETIC_DIR, "repeated-identical-prompt.jsonl"));
    const finding = detectRepeatedIdenticalPrompts(session, AS_OF)[0]!;

    // Hand-computed (sonnet-5 intro: input $2/MTok, output $10/MTok). Discarded turn 1:
    // input 200 tokens → 0.0004; output 40 tokens → 0.0004; total 0.0008.
    // low = output only (0.0004); high = the whole first attempt (0.0008).
    expect(finding.costImpact).toBeDefined();
    expect(finding.costImpact!.low).toBeCloseTo(0.0004, 8);
    expect(finding.costImpact!.high).toBeCloseTo(0.0008, 8);
    expect(finding.costImpact!.low).toBeLessThan(finding.costImpact!.high);
    expect(finding.assumptions?.join(" ")).toContain("discarded");
  });
});

describe("detectRepeatedIdenticalPrompts: true negative", () => {
  test("minimal-session.jsonl (one turn, nothing to compare): zero findings", async () => {
    const { session } = await loadSession(join(SYNTHETIC_DIR, "minimal-session.jsonl"));
    expect(detectRepeatedIdenticalPrompts(session)).toEqual([]);
  });

  test("model-switch.jsonl (two turns, different prompts): zero findings", async () => {
    const { session } = await loadSession(join(SYNTHETIC_DIR, "model-switch.jsonl"));
    expect(detectRepeatedIdenticalPrompts(session)).toEqual([]);
  });
});
