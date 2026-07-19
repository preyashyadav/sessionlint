import { describe, expect, test } from "bun:test";
import { join } from "path";
import { loadSession } from "../adapters/claude-code/session";
import { buildReport } from "./build";

const SYNTHETIC_DIR = join(import.meta.dir, "..", "..", "fixtures", "synthetic");
const AS_OF = new Date("2026-07-10");

describe("buildReport", () => {
  test("a session with a cache-nuke finding is flagged, with turn numbers resolved to 1-based order", async () => {
    const loaded = await loadSession(join(SYNTHETIC_DIR, "model-switch.jsonl"));
    const report = buildReport([loaded], { asOf: AS_OF });

    expect(report.sessionsAnalyzed).toBe(1);
    expect(report.flaggedSessions).toHaveLength(1);
    expect(report.totalFindings).toBe(1);

    const session = report.flaggedSessions[0]!;
    expect(session.findings).toHaveLength(1);
    expect(session.findings[0]?.ruleId).toBe("cache-nuke");
    expect(session.findings[0]?.fromTurnNumber).toBe(1);
    expect(session.findings[0]?.toTurnNumber).toBe(2);
    expect(session.cost.estimated).toBeGreaterThan(0);
  });

  test("a session with no findings is not included in flaggedSessions, but still counted in sessionsAnalyzed", async () => {
    const loaded = await loadSession(join(SYNTHETIC_DIR, "minimal-session.jsonl"));
    const report = buildReport([loaded], { asOf: AS_OF });
    expect(report.sessionsAnalyzed).toBe(1);
    expect(report.flaggedSessions).toEqual([]);
    expect(report.totalFindings).toBe(0);
  });

  test("suppressing a rule id removes just that rule's findings", async () => {
    const loaded = await loadSession(join(SYNTHETIC_DIR, "model-switch.jsonl"));
    const report = buildReport([loaded], { asOf: AS_OF, suppressedRuleIds: ["cache-nuke"] });
    expect(report.flaggedSessions).toEqual([]);
  });

  test("cost.couldHaveBeen is a real range: 0 ≤ low < high ≤ estimated (D-004)", async () => {
    const loaded = await loadSession(join(SYNTHETIC_DIR, "model-switch.jsonl"));
    const report = buildReport([loaded], { asOf: AS_OF });
    const session = report.flaggedSessions[0]!;
    const range = session.cost.couldHaveBeen;
    expect(range).toBeDefined();
    expect(range!.low).toBeGreaterThanOrEqual(0);
    expect(range!.low).toBeLessThan(range!.high);
    expect(range!.high).toBeLessThanOrEqual(session.cost.estimated);
  });

  test("cost.couldHaveBeen is absent (not a zero-width range) when no finding is cost-quantified", async () => {
    // late-compaction with no post-compaction baseline data in the fixture would qualify, but the
    // simplest guaranteed case is a finding whose costImpact the detector omitted: build a report
    // from the compaction fixture and assert the invariant on whatever it produced.
    const loaded = await loadSession(join(SYNTHETIC_DIR, "compaction.jsonl"));
    const report = buildReport([loaded], { asOf: AS_OF });
    for (const session of report.flaggedSessions) {
      const quantified = session.findings.some((f) => f.costImpact !== undefined);
      if (quantified) {
        expect(session.cost.couldHaveBeen).toBeDefined();
        expect(session.cost.couldHaveBeen!.low).toBeLessThan(session.cost.couldHaveBeen!.high);
      } else {
        expect(session.cost.couldHaveBeen).toBeUndefined();
      }
    }
  });

  test("multiple sessions: only flagged ones appear, sessionsAnalyzed counts all", async () => {
    const flagged = await loadSession(join(SYNTHETIC_DIR, "model-switch.jsonl"));
    const clean = await loadSession(join(SYNTHETIC_DIR, "minimal-session.jsonl"));
    const report = buildReport([flagged, clean], { asOf: AS_OF });
    expect(report.sessionsAnalyzed).toBe(2);
    expect(report.flaggedSessions).toHaveLength(1);
    expect(report.flaggedSessions[0]?.sessionId).toBe("synthetic-model-switch");
  });

  test("strips terminal controls and line breaks from transcript-sourced session titles", async () => {
    const loaded = await loadSession(join(SYNTHETIC_DIR, "model-switch.jsonl"));
    loaded.session.turns[0]!.entries[0]!.raw = {
      type: "ai-title",
      aiTitle: "safe\u001b[2J\u001b[31mred\u001b[0m\nnext",
    } as typeof loaded.session.turns[0]["entries"][0]["raw"];
    const report = buildReport([loaded], { asOf: AS_OF });
    expect(report.flaggedSessions[0]?.title).toBe("safered next");
  });
});
