import { describe, expect, test } from "bun:test";
import { readdir } from "fs/promises";
import { join } from "path";
import { loadSession } from "../adapters/claude-code/session";
import { computeSessionCost } from "./compute";

// Runs over the public synthetic corpus so the cost-engine integration check ships in CI.
// (The local-only real fixtures are additionally covered by turns.test.ts's real-fixture
// blocks, which skip when those fixtures are absent.)
const FIXTURES_DIR = join(import.meta.dir, "..", "..", "fixtures", "synthetic");

describe("computeSessionCost: synthetic fixture corpus", () => {
  test("every fixture produces a non-negative, non-throwing cost summary", async () => {
    const files = (await readdir(FIXTURES_DIR)).filter((f) => f.endsWith(".jsonl"));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const { session } = await loadSession(join(FIXTURES_DIR, file));
      const summary = computeSessionCost(session);

      expect(summary.totalCost).toBeGreaterThanOrEqual(0);
      for (const turn of summary.perTurn) {
        expect(turn.totalCost).toBeGreaterThanOrEqual(0);
      }
      // Fixtures use known models; a turn only lands in turnsWithUnknownPricing when its model
      // is null (unresolvable), never an unknown-but-valid-shaped model.
      const turnsWithNullModel = session.turns.filter((t) => t.model === null).length;
      expect(summary.turnsWithUnknownPricing).toBeLessThanOrEqual(turnsWithNullModel);
    }
  });
});
