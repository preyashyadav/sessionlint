import { describe, expect, test } from "bun:test";
import { FakeApiClient } from "./client";
import { replayTurn } from "./replay";
import type { ReconstructedRequest } from "./types";

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

describe("replayTurn: --paranoid disables all network paths (Task 6)", () => {
  test("refuses even when confirmed is true, if paranoid is true", async () => {
    let called = false;
    const apiClient = new FakeApiClient(() => {
      called = true;
      return { content: [], usage: { input_tokens: 0, output_tokens: 0 }, stopReason: "end_turn" };
    });

    await expect(replayTurn(makeRequest(), { confirmed: true, paranoid: true, apiClient })).rejects.toThrow(/paranoid/i);
    expect(called).toBe(false);
  });

  test("proceeds normally when paranoid is false or omitted", async () => {
    const apiClient = new FakeApiClient({
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 10, output_tokens: 5 },
      stopReason: "end_turn",
    });
    const result = await replayTurn(makeRequest(), { confirmed: true, apiClient });
    expect(result.response.content[0]?.text).toBe("ok");
  });
});
