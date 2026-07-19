import { describe, expect, test } from "bun:test";
import { readdir } from "fs/promises";
import { readdirSync } from "fs";
import { join } from "path";
import { loadSession } from "./session";

const REAL_FIXTURES_DIR = join(import.meta.dir, "..", "..", "..", "fixtures");
const SYNTHETIC_DIR = join(REAL_FIXTURES_DIR, "synthetic");

// Real sanitized fixtures are local-only; tests asserting on them skip in the public/CI
// checkout where they're absent (synthetic-corpus tests always run). See turns.test.ts.
const hasRealFixtures = (() => {
  try {
    return readdirSync(REAL_FIXTURES_DIR).some((f) => f.endsWith(".jsonl"));
  } catch {
    return false;
  }
})();

async function allFixturePaths(): Promise<string[]> {
  const real = (await readdir(REAL_FIXTURES_DIR)).filter((f) => f.endsWith(".jsonl")).map((f) => join(REAL_FIXTURES_DIR, f));
  const synthetic = (await readdir(SYNTHETIC_DIR)).filter((f) => f.endsWith(".jsonl")).map((f) => join(SYNTHETIC_DIR, f));
  return [...real, ...synthetic];
}

describe("loadSession: integration over the full fixture corpus", () => {
  test("all fixtures (real + synthetic) load without throwing and produce a capability report", async () => {
    const paths = await allFixturePaths();
    expect(paths.length).toBeGreaterThanOrEqual(12); // 7 real + 5 synthetic — Phase 1 gate: >=10 sessions

    for (const filePath of paths) {
      const { session, capabilities } = await loadSession(filePath);
      expect(session.filePath).toBe(filePath);
      expect(capabilities.gaps.every((g) => typeof g.reason === "string" && g.reason.length > 0)).toBe(true);
      // Never a "missing" severity for CC version distinct from the corpus versions we know about.
      for (const gap of capabilities.gaps) {
        expect(["info", "degraded", "missing"]).toContain(gap.severity);
      }
    }
  });

  test.skipIf(!hasRealFixtures)("real fixture corpus spans >=2 known CC versions (Phase 1 gate)", async () => {
    const real = (await readdir(REAL_FIXTURES_DIR)).filter((f) => f.endsWith(".jsonl"));
    const versions = new Set<string>();
    for (const f of real) {
      const { session } = await loadSession(join(REAL_FIXTURES_DIR, f));
      for (const v of session.ccVersions) versions.add(v);
    }
    expect(versions.size).toBeGreaterThanOrEqual(2);
  });

  test("perf smoke: loading the full fixture corpus completes well under a second", async () => {
    const paths = await allFixturePaths();
    const start = performance.now();
    for (const filePath of paths) {
      await loadSession(filePath);
    }
    const elapsedMs = performance.now() - start;
    expect(elapsedMs).toBeLessThan(1000);
  });

  test.skipIf(!hasRealFixtures)("no real fixture has a spurious model switch (none contain a clean multi-model session)", async () => {
    const real = (await readdir(REAL_FIXTURES_DIR)).filter((f) => f.endsWith(".jsonl"));
    for (const f of real) {
      const { session } = await loadSession(join(REAL_FIXTURES_DIR, f));
      expect(session.modelSwitches).toEqual([]);
    }
  });

  test("synthetic/model-switch.jsonl fires exactly one switch", async () => {
    const { session } = await loadSession(join(SYNTHETIC_DIR, "model-switch.jsonl"));
    expect(session.modelSwitches).toHaveLength(1);
  });
});
