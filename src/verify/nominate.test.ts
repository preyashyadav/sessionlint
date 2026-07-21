import { describe, expect, test } from "bun:test";
import { join } from "path";
import { loadSession } from "../adapters/claude-code/session";
import { isPremiumModel, nominateCandidates } from "./nominate";

const SYNTHETIC_DIR = join(import.meta.dir, "..", "..", "fixtures", "synthetic");

describe("isPremiumModel", () => {
  test("opus/fable/mythos are premium", () => {
    expect(isPremiumModel("claude-opus-4-8")).toBe(true);
    expect(isPremiumModel("claude-fable-5")).toBe(true);
    expect(isPremiumModel("claude-mythos-5")).toBe(true);
  });

  test("sonnet/haiku are not premium", () => {
    expect(isPremiumModel("claude-sonnet-5")).toBe(false);
    expect(isPremiumModel("claude-haiku-4-5")).toBe(false);
  });
});

describe("nominateCandidates: true positive", () => {
  test("model-switch.jsonl: only the opus (premium, tool-call-free) turn is nominated, not the sonnet turn", async () => {
    const { session } = await loadSession(join(SYNTHETIC_DIR, "model-switch.jsonl"));
    const candidates = nominateCandidates(session);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.model).toBe("claude-opus-4-8");
    expect(candidates[0]?.turnId).toBe(session.turns[0]?.turnId);
  });

  test("missing-clear.jsonl: all five opus turns are pure text (no tool calls) and all nominated", async () => {
    const { session } = await loadSession(join(SYNTHETIC_DIR, "missing-clear.jsonl"));
    const candidates = nominateCandidates(session);
    expect(candidates).toHaveLength(5);
    expect(candidates.every((c) => c.model === "claude-opus-4-8")).toBe(true);
  });
});

describe("nominateCandidates: true negative", () => {
  test("giant-file-read.jsonl: sonnet model AND has a tool call — nominated for neither reason", async () => {
    const { session } = await loadSession(join(SYNTHETIC_DIR, "giant-file-read.jsonl"));
    expect(nominateCandidates(session)).toEqual([]);
  });

  test("minimal-session.jsonl: pure text but non-premium model (sonnet) — not nominated", async () => {
    const { session } = await loadSession(join(SYNTHETIC_DIR, "minimal-session.jsonl"));
    expect(nominateCandidates(session)).toEqual([]);
  });
});
