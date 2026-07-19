import { describe, expect, test } from "bun:test";
import { join } from "path";
import { loadSession } from "../adapters/claude-code/session";
import { DEFAULT_SAMPLE_SIZE, stratifiedSample } from "./sample";

const SYNTHETIC_DIR = join(import.meta.dir, "..", "..", "fixtures", "synthetic");

describe("stratifiedSample: exclusions", () => {
  test("a candidate with a secret pattern is excluded, never sampled (redaction proof)", async () => {
    const loaded = [await loadSession(join(SYNTHETIC_DIR, "secret-in-turn.jsonl"))];
    const result = stratifiedSample(loaded);

    expect(result.sampled).toEqual([]);
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0]?.reason).toBe("secret-pattern-match");
  });

  test("a candidate preceded by a stateful tool call is excluded", async () => {
    const loaded = [await loadSession(join(SYNTHETIC_DIR, "stateful-contamination.jsonl"))];
    const result = stratifiedSample(loaded);

    expect(result.sampled).toEqual([]);
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0]?.reason).toBe("stateful-context-contamination");
  });
});

describe("stratifiedSample: clean candidates", () => {
  test("model-switch.jsonl's one clean candidate is sampled with its stratum/family resolved", async () => {
    const loaded = [await loadSession(join(SYNTHETIC_DIR, "model-switch.jsonl"))];
    const result = stratifiedSample(loaded);

    expect(result.excluded).toEqual([]);
    expect(result.sampled).toHaveLength(1);
    expect(result.sampled[0]?.contextStratum).toBe("small");
    expect(result.sampled[0]?.model).toBe("claude-opus-4-8");
  });

  test("missing-clear.jsonl's two clean candidates are both sampled", async () => {
    const loaded = [await loadSession(join(SYNTHETIC_DIR, "missing-clear.jsonl"))];
    const result = stratifiedSample(loaded);
    expect(result.sampled).toHaveLength(2);
    expect(result.excluded).toEqual([]);
  });
});

describe("stratifiedSample: n is tunable, default 40", () => {
  test("caps sampled results at n even when more candidates are available", async () => {
    const loaded = [
      await loadSession(join(SYNTHETIC_DIR, "model-switch.jsonl")),
      await loadSession(join(SYNTHETIC_DIR, "missing-clear.jsonl")),
    ];
    const result = stratifiedSample(loaded, { n: 1 });
    expect(result.sampled).toHaveLength(1);
  });

  test("default n matches the phase spec (40)", () => {
    expect(DEFAULT_SAMPLE_SIZE).toBe(40);
  });

  test("never samples more than exist even if n is large", async () => {
    const loaded = [await loadSession(join(SYNTHETIC_DIR, "missing-clear.jsonl"))];
    const result = stratifiedSample(loaded, { n: 1000 });
    expect(result.sampled).toHaveLength(2);
  });
});
