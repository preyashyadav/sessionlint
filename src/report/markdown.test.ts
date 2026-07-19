import { describe, expect, test } from "bun:test";
import { join } from "path";
import { loadSession } from "../adapters/claude-code/session";
import { buildReport } from "./build";
import { renderMarkdown } from "./markdown";

const SYNTHETIC_DIR = join(import.meta.dir, "..", "..", "fixtures", "synthetic");
const AS_OF = new Date("2026-07-10");

describe("renderMarkdown", () => {
  test("includes a heading, cost line, and finding with a full cost range", async () => {
    const loaded = await loadSession(join(SYNTHETIC_DIR, "model-switch.jsonl"));
    const report = buildReport([loaded], { asOf: AS_OF });
    const output = renderMarkdown(report);

    expect(output).toStartWith("# sessionlint report");
    expect(output).toContain("## syntheti"); // sessionId.slice(0,8), no ai-title in this fixture
    expect(output).toContain("⚠ **CACHE-NUKE**");
    expect(output).toContain("turns 1–2");
    expect(output).toContain("cost impact range:");
    expect(output).toContain("cost: $");
    // D-008 P0: session-level could-have-been is a range, and assumptions are listed.
    expect(output).toMatch(/could plausibly have been ~\$\d+\.\d{2}–\$\d+\.\d{2}/);
    expect(output).toContain("_range assumptions:_");
  });

  test("no flagged sessions: still renders a valid summary line", () => {
    const output = renderMarkdown({ sessionsAnalyzed: 2, totalFindings: 0, flaggedSessions: [] });
    expect(output).toContain("2 session(s) analyzed");
    expect(output).toContain("0 finding(s) across 0 flagged session(s)");
  });
});
