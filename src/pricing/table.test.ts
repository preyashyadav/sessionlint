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

  // Regression: claude-opus-5 shipped 2026-07-24 and became the default model, but the
  // table's last refresh predated it — so every Opus 5 turn resolved to `null` and the
  // whole ledger read $0.00 for the model most sessions actually ran on.
  test("covers the current default model", () => {
    expect(PRICING_TABLE.models["claude-opus-5"]).toBeDefined();
  });

  // Regression, D-009: Sonnet 5's scheduled 2026-09-01 increase to $3/$15 was CANCELLED
  // and $2/$10 became the standard price. The intro-rate machinery was already wired to
  // switch automatically at `effectiveUntil`, so leaving those fields in place would have
  // silently overstated every Sonnet 5 session by 50% from that date onward. Anything that
  // reintroduces them must be a deliberate, sourced decision — not a stale copy-paste.
  test("sonnet-5 carries no intro-rate expiry (the scheduled increase was cancelled)", () => {
    const sonnet5 = PRICING_TABLE.models["claude-sonnet-5"];
    expect(sonnet5?.inputPerMTok).toBe(2.0);
    expect(sonnet5?.outputPerMTok).toBe(10.0);
    expect(sonnet5?.effectiveUntil).toBeUndefined();
    expect(sonnet5?.postIntroRate).toBeUndefined();
  });

  test("fast-mode rates are set only for models that publish one, and cost more than base", () => {
    // Opus 5 and Opus 4.8 are the only models with published fast-mode pricing. Opus 4.6
    // accepts `speed: "fast"` but bills at standard rates and Opus 4.7 rejects it, so a
    // fastRate on either would be a fabricated price rather than a missing one.
    expect(Object.keys(PRICING_TABLE.models).filter((m) => PRICING_TABLE.models[m]?.fastRate)).toEqual([
      "claude-opus-5",
      "claude-opus-4-8",
    ]);
    for (const [model, rate] of Object.entries(PRICING_TABLE.models)) {
      if (!rate.fastRate) continue;
      expect(rate.fastRate.inputPerMTok, `${model} fast input`).toBeGreaterThan(rate.inputPerMTok);
      expect(rate.fastRate.outputPerMTok, `${model} fast output`).toBeGreaterThan(rate.outputPerMTok);
    }
  });
});
