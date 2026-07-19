/**
 * Perf smoke test for the Phase 1 gate ("30-day fixture corpus lints in <
 * 60s"). The full fixture corpus here (16 sessions, real + synthetic) is far
 * smaller than a real 30-day history, so this is an early regression
 * tripwire on the parse->rules->cost->render pipeline, not the formal gate
 * itself — the formal gate needs the human's real history (Task 6, dogfood).
 */

import { describe, expect, test } from "bun:test";
import { readdir } from "fs/promises";
import { join } from "path";
import { loadSession } from "../adapters/claude-code/session";
import { buildReport } from "./build";
import { renderJson } from "./json";
import { renderMarkdown } from "./markdown";
import { renderTerminal } from "./terminal";

const REAL_FIXTURES_DIR = join(import.meta.dir, "..", "..", "fixtures");
const SYNTHETIC_DIR = join(REAL_FIXTURES_DIR, "synthetic");

describe("full pipeline perf smoke test", () => {
  test("discover->parse->rules->cost->render over the full fixture corpus completes in well under 60s", async () => {
    const real = (await readdir(REAL_FIXTURES_DIR)).filter((f) => f.endsWith(".jsonl")).map((f) => join(REAL_FIXTURES_DIR, f));
    const synthetic = (await readdir(SYNTHETIC_DIR)).filter((f) => f.endsWith(".jsonl")).map((f) => join(SYNTHETIC_DIR, f));
    const allPaths = [...real, ...synthetic];
    expect(allPaths.length).toBeGreaterThanOrEqual(16);

    const start = performance.now();
    const loaded = await Promise.all(allPaths.map((p) => loadSession(p)));
    const report = buildReport(loaded);
    renderTerminal(report);
    renderMarkdown(report);
    renderJson(report);
    const elapsedMs = performance.now() - start;

    expect(elapsedMs).toBeLessThan(60_000);
    // Also assert something much tighter as a real regression tripwire — the
    // 60s figure is the Phase 1 gate's number for a 30-day real corpus, not
    // a target for this much smaller fixture set.
    expect(elapsedMs).toBeLessThan(2_000);
  });
});
