import { describe, expect, test } from "bun:test";
import { llmJudge } from "./llm-judge";
import type { JudgeClient, LlmVerdict } from "./types";

function contentBasedJudge(verdictFor: (a: string, b: string) => LlmVerdict): JudgeClient {
  return {
    judge: async ({ responseA, responseB }) => verdictFor(responseA, responseB),
  };
}

describe("llmJudge: unbiased judge agrees across both orders", () => {
  test("truly equivalent responses: both orders say equivalent -> final verdict equivalent", async () => {
    // A content-based (not position-based) judge: equivalent iff same normalized text.
    const client = contentBasedJudge((a, b) => (a.trim() === b.trim() ? "equivalent" : "not-equivalent"));
    const result = await llmJudge(client, "task", "Done.", "Done.");
    expect(result.orderAVerdict).toBe("equivalent");
    expect(result.orderBVerdict).toBe("equivalent");
    expect(result.verdict).toBe("equivalent");
  });

  test("truly different responses: both orders say not-equivalent -> final verdict not-equivalent", async () => {
    const client = contentBasedJudge((a, b) => (a.trim() === b.trim() ? "equivalent" : "not-equivalent"));
    const result = await llmJudge(client, "task", "Fixed the auth bug.", "Added a new feature.");
    expect(result.verdict).toBe("not-equivalent");
  });
});

describe("llmJudge: position-bias control (required by the Phase 2 test gate)", () => {
  test("a position-biased judge (always favors whichever response is labeled A) disagrees across orders and never produces a false pass", async () => {
    // This judge ignores content entirely and always calls "A" the winner — a textbook
    // position bias. Feed it a genuinely symmetric fixture (the two responses are, in fact,
    // equivalent) and prove the orchestration catches the bias via disagreement rather than
    // reporting a false "equivalent".
    const biasedClient: JudgeClient = {
      judge: async () => "equivalent" as const,
    };
    // Even a judge that ALWAYS says "equivalent" regardless of order will (correctly) still
    // agree in this case — bias alone isn't disagreement. Use a judge biased toward the
    // *content* of whichever string appears in the responseA slot to make the position
    // dependency concrete:
    const positionBiasedClient: JudgeClient = {
      judge: async ({ responseA }) => (responseA.includes("ORIGINAL_MARKER") ? "equivalent" : "not-equivalent"),
    };

    const original = "The fix is in place. ORIGINAL_MARKER";
    const replayed = "The fix is in place.";

    // Order A: original first (has the marker) -> biased judge says "equivalent".
    // Order B: replayed first (no marker) -> biased judge says "not-equivalent".
    // A real, content-based equivalence between these two would agree either way; this
    // judge's verdict flips purely because of *position*, not content -- exactly what the
    // disagreement check must catch.
    const result = await llmJudge(positionBiasedClient, "task", original, replayed);
    expect(result.orderAVerdict).not.toBe(result.orderBVerdict);
    expect(result.verdict).toBe("uncertain");
    expect(result.verdict).not.toBe("equivalent"); // never a false pass on disagreement

    // Sanity: the always-agrees client above never disagrees, proving the test setup itself
    // is capable of returning "equivalent" when there's truly no disagreement.
    const alwaysAgrees = await llmJudge(biasedClient, "task", original, replayed);
    expect(alwaysAgrees.verdict).toBe("equivalent");
  });

  test("disagreement between orders always resolves to uncertain, never silently picks one order's answer", async () => {
    let callCount = 0;
    const alternatingClient: JudgeClient = {
      judge: async () => {
        callCount++;
        return callCount % 2 === 1 ? "equivalent" : "not-equivalent";
      },
    };
    const result = await llmJudge(alternatingClient, "task", "a", "b");
    expect(result.verdict).toBe("uncertain");
  });
});
