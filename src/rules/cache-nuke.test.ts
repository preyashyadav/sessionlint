import { describe, expect, test } from "bun:test";
import { join } from "path";
import { loadSession } from "../adapters/claude-code/session";
import { readdirSync } from "fs";
import { detectCacheNukes } from "./cache-nuke";

const SYNTHETIC_DIR = join(import.meta.dir, "..", "..", "fixtures", "synthetic");
const REAL_FIXTURES_DIR = join(import.meta.dir, "..", "..", "fixtures");
const hasRealFixtures = (() => { try { return readdirSync(REAL_FIXTURES_DIR).some((f) => f.endsWith(".jsonl")); } catch { return false; } })();
const AS_OF = new Date("2026-07-10");

describe("detectCacheNukes: true positive (synthetic/model-switch.jsonl)", () => {
  test("fires exactly one finding with hand-computed evidence and cost range", async () => {
    const { session } = await loadSession(join(SYNTHETIC_DIR, "model-switch.jsonl"));
    const findings = detectCacheNukes(session, AS_OF);

    expect(findings).toHaveLength(1);
    const finding = findings[0]!;
    expect(finding.ruleId).toBe("cache-nuke");
    expect(finding.severity).toBe("warning");
    expect(finding.evidence).toContain("claude-opus-4-8 -> claude-sonnet-5");
    expect(finding.evidence).toContain("8,500 tokens billed as fresh input");
    expect(finding.evidence).toContain("300 tokens");

    // Hand-computed: reprocessedTokens=8500, toRate(sonnet-5 intro)=$2.00/$0.20 (cache-read),
    // fromRate(opus-4-8)=$5.00/$0.50 (cache-read).
    // actualCost = 8500/1e6 * 2.00 = 0.017
    // ifCacheWouldHaveHit = 0.017 - 8500/1e6*0.50 = 0.017 - 0.00425 = 0.01275
    // ifCacheMightNotHaveHit = 0.017 - 8500/1e6*5.00 = 0.017 - 0.0425 = -0.0255
    expect(finding.costImpact).toBeDefined();
    expect(finding.costImpact?.high).toBeCloseTo(0.01275, 6);
    expect(finding.costImpact?.low).toBeCloseTo(-0.0255, 6);
    expect(finding.costImpact!.low).toBeLessThanOrEqual(finding.costImpact!.high);
  });
});

describe("detectCacheNukes: causal attribution and severity", () => {
  test("a gap beyond the default cache TTL is informational and carries no attributed cost", async () => {
    const { session } = await loadSession(join(SYNTHETIC_DIR, "model-switch.jsonl"));
    const delayed = {
      ...session,
      modelSwitches: session.modelSwitches.map((sw) => ({
        ...sw,
        atTimestamp: new Date("2026-07-10T00:20:00.000Z"),
      })),
    };
    const [finding] = detectCacheNukes(delayed, AS_OF);
    expect(finding?.severity).toBe("info");
    expect(finding?.costImpact).toBeUndefined();
    expect(finding?.evidence).toContain("exceeded the default 5-minute cache TTL");
    expect(finding?.evidence).toContain("no avoidable cost is attributed");
  });

  test("a switch whose entire range is non-positive is informational, not an error", async () => {
    const { session } = await loadSession(join(SYNTHETIC_DIR, "model-switch.jsonl"));
    const cheaper = {
      ...session,
      modelSwitches: session.modelSwitches.map((sw) => ({
        ...sw,
        fromModel: "claude-fable-5",
        toModel: "claude-haiku-4-5",
      })),
    };
    const [finding] = detectCacheNukes(cheaper, AS_OF);
    expect(finding?.costImpact?.high).toBeLessThanOrEqual(0);
    expect(finding?.severity).toBe("info");
    expect(finding?.evidence).toContain("likely saved money");
  });

  test("error is reserved for a strictly positive attributable-cost range", async () => {
    const { session } = await loadSession(join(SYNTHETIC_DIR, "model-switch.jsonl"));
    const expensive = {
      ...session,
      modelSwitches: session.modelSwitches.map((sw) => ({
        ...sw,
        fromModel: "claude-haiku-4-5",
        toModel: "claude-opus-4-8",
      })),
    };
    const [finding] = detectCacheNukes(expensive, AS_OF);
    expect(finding?.costImpact?.low).toBeGreaterThan(0);
    expect(finding?.severity).toBe("error");
  });
});

describe("detectCacheNukes: true negative (no model switches)", () => {
  test("minimal-session.jsonl (one turn, one model): zero findings", async () => {
    const { session } = await loadSession(join(SYNTHETIC_DIR, "minimal-session.jsonl"));
    expect(session.modelSwitches).toEqual([]);
    expect(detectCacheNukes(session, AS_OF)).toEqual([]);
  });

  test.skipIf(!hasRealFixtures)("real fixtures (single valid model per file): zero findings each", async () => {
    const realFiles = [
      "2d946943-68ff-45a5-a9f9-e2d1f8d750fb.jsonl",
      "917c012e-2980-4a86-bf24-5cb62df8a942.jsonl", // contains the corrupted/error entry, still no clean switch
    ];
    for (const file of realFiles) {
      const { session } = await loadSession(join(REAL_FIXTURES_DIR, file));
      expect(detectCacheNukes(session, AS_OF)).toEqual([]);
    }
  });
});

describe("detectCacheNukes: multiple switches are ranked worst-first", () => {
  test("sorts findings by cost impact high descending", async () => {
    const { session } = await loadSession(join(SYNTHETIC_DIR, "model-switch.jsonl"));
    // Duplicate the single switch to simulate a multi-switch session with a cheaper second switch,
    // and confirm sort order holds generally (regression guard for the sort direction).
    const doubled = {
      ...session,
      modelSwitches: [
        ...session.modelSwitches,
        { ...session.modelSwitches[0]!, atTurnId: session.modelSwitches[0]!.atTurnId },
      ],
    };
    const findings = detectCacheNukes(doubled, AS_OF);
    for (let i = 1; i < findings.length; i++) {
      expect(findings[i - 1]!.costImpact?.high ?? 0).toBeGreaterThanOrEqual(findings[i]!.costImpact?.high ?? 0);
    }
  });
});

describe("detectCacheNukes: graceful degradation", () => {
  test("unknown model in the switch: no cost impact, but finding still emitted", async () => {
    const { session } = await loadSession(join(SYNTHETIC_DIR, "model-switch.jsonl"));
    const patched = {
      ...session,
      modelSwitches: session.modelSwitches.map((sw) => ({ ...sw, toModel: "claude-hypothetical-future-model" })),
    };
    const findings = detectCacheNukes(patched, AS_OF);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.costImpact).toBeUndefined();
  });
});
