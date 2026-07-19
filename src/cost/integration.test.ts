import { describe, expect, test } from "bun:test";
import { readdir } from "fs/promises";
import { join } from "path";
import { loadSession } from "../adapters/claude-code/session";
import { computeSessionCost } from "./compute";

const FIXTURES_DIR = join(import.meta.dir, "..", "..", "fixtures");

describe("computeSessionCost: real fixture corpus", () => {
  test("every real fixture produces a non-negative, non-throwing cost summary", async () => {
    const files = (await readdir(FIXTURES_DIR)).filter((f) => f.endsWith(".jsonl"));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const { session } = await loadSession(join(FIXTURES_DIR, file));
      const summary = computeSessionCost(session);

      expect(summary.totalCost).toBeGreaterThanOrEqual(0);
      for (const turn of summary.perTurn) {
        expect(turn.totalCost).toBeGreaterThanOrEqual(0);
      }
      // Every real fixture uses known models (opus-4-8/sonnet-5/fable-5) except
      // the one turn containing the corrupted/error entry, whose model resolves
      // to null (modelValid: false) rather than an unknown-but-valid-shaped model.
      const turnsWithNullModel = session.turns.filter((t) => t.model === null).length;
      expect(summary.turnsWithUnknownPricing).toBeLessThanOrEqual(turnsWithNullModel);
    }
  });
});
