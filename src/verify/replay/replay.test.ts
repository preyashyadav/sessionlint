import { describe, expect, test } from "bun:test";
import { FakeApiClient } from "./client";
import { replayTurn } from "./replay";
import type { ReconstructedRequest } from "./types";

const AS_OF = new Date("2026-07-10");

function makeRequest(): ReconstructedRequest {
  return {
    sessionId: "s1",
    turnId: "t1",
    originalModel: "claude-opus-4-8",
    model: "claude-sonnet-5",
    messages: [{ role: "user", content: "hello" }],
    maxTokens: 4096,
    systemPromptOmitted: true,
    toolContentOmitted: true,
  };
}

describe("replayTurn: mandatory confirmation gate (critical safety property)", () => {
  test("refuses when confirmed is false — never calls the API client", async () => {
    let called = false;
    const apiClient = new FakeApiClient(() => {
      called = true;
      return { content: [{ type: "text", text: "x" }], usage: { input_tokens: 1, output_tokens: 1 }, stopReason: "end_turn" };
    });

    await expect(replayTurn(makeRequest(), { confirmed: false, apiClient }, AS_OF)).rejects.toThrow(/confirmed/i);
    expect(called).toBe(false);
  });

  test("refuses when confirmed is omitted (undefined) — no implicit default to true", async () => {
    const apiClient = new FakeApiClient({
      content: [],
      usage: { input_tokens: 0, output_tokens: 0 },
      stopReason: "end_turn",
    });
    // @ts-expect-error — deliberately omitting `confirmed` to prove there's no default
    await expect(replayTurn(makeRequest(), { apiClient }, AS_OF)).rejects.toThrow(/confirmed/i);
  });

  test("proceeds and computes actual cost when confirmed is true", async () => {
    const apiClient = new FakeApiClient({
      content: [{ type: "text", text: "Replayed response." }],
      usage: { input_tokens: 100, output_tokens: 50 },
      stopReason: "end_turn",
    });

    const result = await replayTurn(makeRequest(), { confirmed: true, apiClient }, AS_OF);
    expect(result.response.content[0]?.text).toBe("Replayed response.");
    // sonnet-5 intro rate at 2026-07-10: input $2.00/MTok, output $10.00/MTok
    // (100/1e6)*2.00 + (50/1e6)*10.00 = 0.0002 + 0.0005 = 0.0007
    expect(result.actualCost).toBeCloseTo(0.0007, 6);
  });

  test("unknown model in the request: actualCost is 0, never throws", async () => {
    const apiClient = new FakeApiClient({
      content: [],
      usage: { input_tokens: 100, output_tokens: 50 },
      stopReason: "end_turn",
    });
    const request = { ...makeRequest(), model: "claude-hypothetical-future-model" };
    const result = await replayTurn(request, { confirmed: true, apiClient }, AS_OF);
    expect(result.actualCost).toBe(0);
  });
});
