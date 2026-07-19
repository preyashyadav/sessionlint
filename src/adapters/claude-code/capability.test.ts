import { describe, expect, test } from "bun:test";
import { computeCapabilityReport } from "./capability";
import type { Session, Turn } from "./types";

function makeTurn(overrides: Partial<Turn> = {}): Turn {
  return {
    turnId: "t1",
    turnIdSource: "prompt-id",
    startedAt: new Date("2026-07-10T00:00:00Z"),
    entries: [
      {
        raw: { type: "assistant" },
        lineNumber: 1,
        uuid: "a1",
        parentUuid: null,
        timestamp: new Date("2026-07-10T00:00:00Z"),
        kind: "assistant-message",
      },
    ],
    model: "claude-sonnet-5",
    modelRaw: "claude-sonnet-5",
    modelValid: true,
    usage: { inputTokens: 100, outputTokens: 20, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, raw: [{}] },
    content: { hasText: true, toolUseNames: ["Read"], toolResultCount: 1 },
    ...overrides,
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    sessionId: "s1",
    filePath: "/fake/path.jsonl",
    ccVersions: ["2.1.201"],
    turns: [makeTurn()],
    modelSwitches: [],
    entryCount: 3,
    unknownTypeCounts: {},
    parseErrorCount: 0,
    ...overrides,
  };
}

describe("computeCapabilityReport", () => {
  test("healthy session: everything supported, no gaps", () => {
    const report = computeCapabilityReport(makeSession(), {
      invalidModelCount: 0,
      usedTurnGroupingFallback: false,
    });
    expect(report.gaps).toEqual([]);
    expect(report.supported).toEqual(
      expect.arrayContaining([
        "content-text",
        "model-recoverable",
        "tool-call-recoverable",
        "tool-result-recoverable",
        "usage-fields",
        "turn-grouping",
        "version-known",
        "entry-type-known",
      ])
    );
  });

  test("empty session: content/model gaps are 'missing' severity", () => {
    const report = computeCapabilityReport(makeSession({ turns: [] }), {
      invalidModelCount: 0,
      usedTurnGroupingFallback: false,
    });
    const contentGap = report.gaps.find((g) => g.capability === "content-text");
    const modelGap = report.gaps.find((g) => g.capability === "model-recoverable");
    expect(contentGap?.severity).toBe("missing");
    expect(modelGap?.severity).toBe("missing");
  });

  test("invalid model count adds an info gap even when session is otherwise healthy", () => {
    const report = computeCapabilityReport(makeSession(), {
      invalidModelCount: 2,
      usedTurnGroupingFallback: false,
    });
    const gap = report.gaps.find((g) => g.capability === "model-recoverable" && g.severity === "info");
    expect(gap?.reason).toContain("2 assistant entries");
    // model-recoverable can still be supported overall since >=1 turn has a valid model.
    expect(report.supported).toContain("model-recoverable");
  });

  test("turn-grouping fallback usage is reported as degraded, not supported", () => {
    const report = computeCapabilityReport(makeSession(), {
      invalidModelCount: 0,
      usedTurnGroupingFallback: true,
    });
    expect(report.supported).not.toContain("turn-grouping");
    const gap = report.gaps.find((g) => g.capability === "turn-grouping");
    expect(gap?.severity).toBe("degraded");
  });

  test("unknown CC version gets a named info gap", () => {
    const report = computeCapabilityReport(makeSession({ ccVersions: ["9.9.999"] }), {
      invalidModelCount: 0,
      usedTurnGroupingFallback: false,
    });
    const gap = report.gaps.find((g) => g.capability === "version-known");
    expect(gap?.severity).toBe("info");
    expect(gap?.detail).toBe("9.9.999");
    expect(report.supported).not.toContain("version-known");
  });

  test("no CC version at all is degraded, not just info", () => {
    const report = computeCapabilityReport(makeSession({ ccVersions: [] }), {
      invalidModelCount: 0,
      usedTurnGroupingFallback: false,
    });
    const gap = report.gaps.find((g) => g.capability === "version-known");
    expect(gap?.severity).toBe("degraded");
  });

  test("unknown entry types each get a named gap with a count", () => {
    const report = computeCapabilityReport(
      makeSession({ unknownTypeCounts: { "future-feature-xyz": 3 } }),
      { invalidModelCount: 0, usedTurnGroupingFallback: false }
    );
    const gap = report.gaps.find((g) => g.capability === "entry-type-known");
    expect(gap?.reason).toContain("future-feature-xyz");
    expect(gap?.detail).toBe("count: 3");
    expect(report.supported).not.toContain("entry-type-known");
  });

  test("text present but no tool signal at all: degraded, not missing", () => {
    const report = computeCapabilityReport(
      makeSession({ turns: [makeTurn({ content: { hasText: true, toolUseNames: [], toolResultCount: 0 } })] }),
      { invalidModelCount: 0, usedTurnGroupingFallback: false }
    );
    const toolUseGap = report.gaps.find((g) => g.capability === "tool-call-recoverable");
    const toolResultGap = report.gaps.find((g) => g.capability === "tool-result-recoverable");
    expect(toolUseGap?.severity).toBe("degraded");
    expect(toolResultGap?.severity).toBe("degraded");
  });

  test("assistant entries present but none carry usage: missing severity", () => {
    const session = makeSession({
      turns: [
        makeTurn({
          usage: null,
          entries: [
            {
              raw: { type: "assistant" },
              lineNumber: 1,
              uuid: "a1",
              parentUuid: null,
              timestamp: new Date(),
              kind: "assistant-message",
            },
          ],
        }),
      ],
    });
    const report = computeCapabilityReport(session, { invalidModelCount: 0, usedTurnGroupingFallback: false });
    const gap = report.gaps.find((g) => g.capability === "usage-fields");
    expect(gap?.severity).toBe("missing");
  });

  test("no assistant entries at all: usage-fields check is skipped, not flagged", () => {
    const session = makeSession({ turns: [makeTurn({ usage: null, entries: [] })] });
    const report = computeCapabilityReport(session, { invalidModelCount: 0, usedTurnGroupingFallback: false });
    expect(report.gaps.find((g) => g.capability === "usage-fields")).toBeUndefined();
  });

  test("ccVersion in report reflects the session's first detected version", () => {
    const report = computeCapabilityReport(makeSession({ ccVersions: ["2.1.201", "2.1.204"] }), {
      invalidModelCount: 0,
      usedTurnGroupingFallback: false,
    });
    expect(report.ccVersion).toBe("2.1.201");
  });
});
