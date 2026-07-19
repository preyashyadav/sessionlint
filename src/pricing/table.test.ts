import { describe, expect, test } from "bun:test";
import { PRICING_TABLE } from "./table";

describe("PRICING_TABLE", () => {
  test("has a retrieval date and source URL", () => {
    expect(PRICING_TABLE.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(PRICING_TABLE.sourceUrl).toStartWith("https://");
  });

  test("every model has positive, non-zero input/output rates", () => {
    for (const [model, rate] of Object.entries(PRICING_TABLE.models)) {
      expect(rate.inputPerMTok, `${model} input rate`).toBeGreaterThan(0);
      expect(rate.outputPerMTok, `${model} output rate`).toBeGreaterThan(0);
    }
  });

  test("output rate is always more expensive than input rate (holds for every real Claude model)", () => {
    for (const [model, rate] of Object.entries(PRICING_TABLE.models)) {
      expect(rate.outputPerMTok, model).toBeGreaterThan(rate.inputPerMTok);
    }
  });

  test("covers every model seen in the fixture corpus", () => {
    for (const model of ["claude-opus-4-8", "claude-sonnet-5", "claude-fable-5"]) {
      expect(PRICING_TABLE.models[model]).toBeDefined();
    }
  });

  test("sonnet-5 intro rate has a well-formed expiry date", () => {
    expect(PRICING_TABLE.models["claude-sonnet-5"]?.effectiveUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
