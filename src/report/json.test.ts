import { describe, expect, test } from "bun:test";
import { join } from "path";
import { loadSession } from "../adapters/claude-code/session";
import { buildReport } from "./build";
import { renderJson } from "./json";

const SYNTHETIC_DIR = join(import.meta.dir, "..", "..", "fixtures", "synthetic");
const AS_OF = new Date("2026-07-10");

describe("renderJson", () => {
  test("round-trips through JSON.parse and preserves the full cost-impact range", async () => {
    const loaded = await loadSession(join(SYNTHETIC_DIR, "model-switch.jsonl"));
    const report = buildReport([loaded], { asOf: AS_OF });
    const parsed = JSON.parse(renderJson(report));

    expect(parsed.sessionsAnalyzed).toBe(1);
    expect(parsed.flaggedSessions).toHaveLength(1);
    const finding = parsed.flaggedSessions[0].findings[0];
    expect(finding.ruleId).toBe("cache-nuke");
    // D-004: the exact range must survive, not just a collapsed point estimate.
    expect(finding.costImpact.low).toBeLessThan(finding.costImpact.high);
    // D-008 P0: the labeled assumptions ship with the range in machine output.
    expect(Array.isArray(finding.assumptions)).toBe(true);
    expect(finding.assumptions.length).toBeGreaterThan(0);
    // Session-level "could have been" is a range object too, never a scalar.
    const cost = parsed.flaggedSessions[0].cost;
    expect(typeof cost.estimated).toBe("number");
    expect(cost.couldHaveBeen.low).toBeLessThan(cost.couldHaveBeen.high);
  });
});

describe("renderJson: versioned output", () => {
  test("carries a top-level schemaVersion", async () => {
    const { JSON_SCHEMA_VERSION } = await import("./json");
    const parsed = JSON.parse(renderJson({ sessionsAnalyzed: 0, totalFindings: 0, flaggedSessions: [] }));
    expect(parsed.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(parsed.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    // report fields remain top-level (additive, non-breaking for existing consumers)
    expect(parsed.sessionsAnalyzed).toBe(0);
  });
});
