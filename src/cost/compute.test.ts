import { describe, expect, test } from "bun:test";
import type { Session, Turn } from "../adapters/claude-code/types";
import { computeSessionCost, computeTurnCost } from "./compute";

const AS_OF = new Date("2026-07-10");

function makeTurn(overrides: Partial<Turn> = {}): Turn {
  return {
    turnId: "t1",
    turnIdSource: "prompt-id",
    startedAt: AS_OF,
    entries: [],
    model: "claude-opus-4-8",
    modelRaw: "claude-opus-4-8",
    modelValid: true,
    usage: null,
    content: { hasText: true, toolUseNames: [], toolResultCount: 0 },
    ...overrides,
  };
}

describe("computeTurnCost: exact fixture match", () => {
  test("hand-computed cost for a fully-specified opus-4-8 turn", () => {
    const turn = makeTurn({
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 500_000,
        cacheCreationInputTokens: 150_000,
        cacheReadInputTokens: 2_000_000,
        raw: [
          {
            cache_creation_input_tokens: 150_000,
            cache_creation: { ephemeral_5m_input_tokens: 100_000, ephemeral_1h_input_tokens: 50_000 },
          },
        ],
      },
    });

    const cost = computeTurnCost(turn, AS_OF);

    // input: 1M tok * $5.00/MTok = $5.00
    expect(cost.inputCost).toBeCloseTo(5.0, 6);
    // output: 0.5M tok * $25.00/MTok = $12.50
    expect(cost.outputCost).toBeCloseTo(12.5, 6);
    // cache read: 2M tok * ($5.00 * 0.1)/MTok = 2 * 0.5 = $1.00
    expect(cost.cacheReadCost).toBeCloseTo(1.0, 6);
    // cache write: 0.1M * ($5.00*1.25) + 0.05M * ($5.00*2) = 0.1*6.25 + 0.05*10 = 0.625 + 0.5 = $1.125
    expect(cost.cacheWriteCost).toBeCloseTo(1.125, 6);
    expect(cost.totalCost).toBeCloseTo(5.0 + 12.5 + 1.0 + 1.125, 6);
    expect(cost.pricingKnown).toBe(true);
    expect(cost.cacheBreakdownAssumed).toBe(false);
  });

  test("falls back to all-5m-rate when cache_creation lacks the nested breakdown, and flags it", () => {
    const turn = makeTurn({
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 100_000,
        cacheReadInputTokens: 0,
        raw: [{ cache_creation_input_tokens: 100_000 }], // no nested `cache_creation` object
      },
    });

    const cost = computeTurnCost(turn, AS_OF);
    // 0.1M * ($5.00 * 1.25) = $0.625, all attributed to 5m rate
    expect(cost.cacheWriteCost).toBeCloseTo(0.625, 6);
    expect(cost.cacheBreakdownAssumed).toBe(true);
  });

  test("unknown model: zero cost, pricingKnown false, never throws", () => {
    const turn = makeTurn({
      model: "claude-hypothetical-future-model",
      modelRaw: "claude-hypothetical-future-model",
      usage: { inputTokens: 1000, outputTokens: 1000, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, raw: [] },
    });
    const cost = computeTurnCost(turn, AS_OF);
    expect(cost.pricingKnown).toBe(false);
    expect(cost.totalCost).toBe(0);
  });

  test("no valid model on the turn: zero cost, pricingKnown false", () => {
    const turn = makeTurn({ model: null, modelRaw: "lorem ipsum garbage" });
    const cost = computeTurnCost(turn, AS_OF);
    expect(cost.pricingKnown).toBe(false);
    expect(cost.totalCost).toBe(0);
    expect(cost.model).toBe("lorem ipsum garbage");
  });
});

describe("computeTurnCost: property — non-negativity", () => {
  test("cost is never negative across many random non-negative token combinations", () => {
    const models = ["claude-opus-4-8", "claude-sonnet-5", "claude-fable-5", "claude-haiku-4-5"];
    for (let i = 0; i < 500; i++) {
      const model = models[i % models.length]!;
      const turn = makeTurn({
        model,
        modelRaw: model,
        usage: {
          inputTokens: Math.floor(Math.random() * 1_000_000),
          outputTokens: Math.floor(Math.random() * 1_000_000),
          cacheCreationInputTokens: Math.floor(Math.random() * 1_000_000),
          cacheReadInputTokens: Math.floor(Math.random() * 1_000_000),
          raw: [
            {
              cache_creation: {
                ephemeral_5m_input_tokens: Math.floor(Math.random() * 500_000),
                ephemeral_1h_input_tokens: Math.floor(Math.random() * 500_000),
              },
            },
          ],
        },
      });
      const cost = computeTurnCost(turn, AS_OF);
      expect(cost.inputCost).toBeGreaterThanOrEqual(0);
      expect(cost.outputCost).toBeGreaterThanOrEqual(0);
      expect(cost.cacheWriteCost).toBeGreaterThanOrEqual(0);
      expect(cost.cacheReadCost).toBeGreaterThanOrEqual(0);
      expect(cost.totalCost).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("computeSessionCost: property — additivity", () => {
  test("session total equals the sum of independently-computed per-turn costs", () => {
    const models = ["claude-opus-4-8", "claude-sonnet-5", "claude-fable-5"];
    for (let trial = 0; trial < 50; trial++) {
      const turnCount = 1 + Math.floor(Math.random() * 10);
      const turns: Turn[] = Array.from({ length: turnCount }, (_, i) => {
        const model = models[i % models.length]!;
        return makeTurn({
          turnId: `t${i}`,
          model,
          modelRaw: model,
          usage: {
            inputTokens: Math.floor(Math.random() * 100_000),
            outputTokens: Math.floor(Math.random() * 50_000),
            cacheCreationInputTokens: Math.floor(Math.random() * 20_000),
            cacheReadInputTokens: Math.floor(Math.random() * 200_000),
            raw: [{ cache_creation: { ephemeral_5m_input_tokens: Math.floor(Math.random() * 20_000) } }],
          },
        });
      });

      const session: Session = {
        sessionId: "s1",
        filePath: "/fake.jsonl",
        ccVersions: ["2.1.201"],
        turns,
        modelSwitches: [],
        entryCount: turns.length,
        unknownTypeCounts: {},
        parseErrorCount: 0,
      };

      const summary = computeSessionCost(session, AS_OF);
      const independentSum = turns.reduce((sum, t) => sum + computeTurnCost(t, AS_OF).totalCost, 0);
      expect(summary.totalCost).toBeCloseTo(independentSum, 9);
    }
  });
});

describe("computeSessionCost: pricing staleness wiring", () => {
  test("pricingStale is false as-of the table's own retrieval date", () => {
    const session: Session = {
      sessionId: "s1",
      filePath: "/fake.jsonl",
      ccVersions: [],
      turns: [],
      modelSwitches: [],
      entryCount: 0,
      unknownTypeCounts: {},
      parseErrorCount: 0,
    };
    expect(computeSessionCost(session, new Date("2026-07-10")).pricingStale).toBe(false);
  });

  test("pricingStale is true long after the table's retrieval date", () => {
    const session: Session = {
      sessionId: "s1",
      filePath: "/fake.jsonl",
      ccVersions: [],
      turns: [],
      modelSwitches: [],
      entryCount: 0,
      unknownTypeCounts: {},
      parseErrorCount: 0,
    };
    expect(computeSessionCost(session, new Date("2027-01-01")).pricingStale).toBe(true);
  });
});
