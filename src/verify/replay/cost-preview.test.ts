import { describe, expect, test } from "bun:test";
import { previewCost } from "./cost-preview";
import type { ReconstructedRequest } from "./types";

function makeRequest(overrides: Partial<ReconstructedRequest> = {}): ReconstructedRequest {
  return {
    sessionId: "s1",
    turnId: "t1",
    originalModel: "claude-opus-4-8",
    model: "claude-sonnet-5",
    messages: [{ role: "user", content: "a".repeat(4000) }], // ~1000 estimated tokens
    maxTokens: 4096,
    systemPromptOmitted: true,
    toolContentOmitted: true,
    ...overrides,
  };
}

describe("previewCost", () => {
  test("returns a range, never a point estimate (D-004)", () => {
    const preview = previewCost(makeRequest());
    expect(preview.estimatedCostRange.low).toBeLessThan(preview.estimatedCostRange.high);
  });

  test("estimatedInputTokens scales with input length (chars/4 heuristic)", () => {
    const small = previewCost(makeRequest({ messages: [{ role: "user", content: "a".repeat(400) }] }));
    const large = previewCost(makeRequest({ messages: [{ role: "user", content: "a".repeat(40000) }] }));
    expect(large.estimatedInputTokens).toBeGreaterThan(small.estimatedInputTokens * 50);
  });

  test("unknown model: zero-cost range, never throws", () => {
    const preview = previewCost(makeRequest({ model: "claude-hypothetical-future-model" }));
    expect(preview.estimatedCostRange).toEqual({ low: 0, high: 0 });
  });

  test("maxOutputTokens reflects the request's budget cap, not a prediction", () => {
    const preview = previewCost(makeRequest({ maxTokens: 1234 }));
    expect(preview.maxOutputTokens).toBe(1234);
  });

  test("both bounds are non-negative", () => {
    const preview = previewCost(makeRequest());
    expect(preview.estimatedCostRange.low).toBeGreaterThanOrEqual(0);
    expect(preview.estimatedCostRange.high).toBeGreaterThanOrEqual(0);
  });
});
