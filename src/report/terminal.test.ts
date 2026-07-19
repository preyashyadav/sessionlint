import { describe, expect, test } from "bun:test";
import { join } from "path";
import { loadSession } from "../adapters/claude-code/session";
import { buildReport } from "./build";
import { renderTerminal } from "./terminal";

const SYNTHETIC_DIR = join(import.meta.dir, "..", "..", "fixtures", "synthetic");
const AS_OF = new Date("2026-07-10");

describe("renderTerminal", () => {
  test("matches README v0's mock structure: header, divider box, finding line, explain link, footer", async () => {
    const loaded = await loadSession(join(SYNTHETIC_DIR, "model-switch.jsonl"));
    const report = buildReport([loaded], { asOf: AS_OF });
    const output = renderTerminal(report);

    expect(output).toContain("sessionlint · 1 session analyzed");
    expect(output).toContain("session  syntheti"); // sessionId.slice(0, 8)
    expect(output).toContain("⚠ CACHE-NUKE");
    expect(output).toContain("turns 1–2");
    expect(output).toContain("→ sessionlint explain cache-nuke");
    expect(output).toContain("session cost: $");
    // D-008 P0: the session-level line is a range ("~$X.XX–$Y.YY"), never a point.
    expect(output).toMatch(/could plausibly have been ~\$\d+\.\d{2}–\$\d+\.\d{2}/);
    expect(output).toContain("1 finding across 1 flagged session · replay-audit with: sessionlint --verify");

    // Divider lines bookend both the session box (top+bottom) and the footer (top+bottom).
    const dividerCount = output.split("\n").filter((l) => l.startsWith("━")).length;
    expect(dividerCount).toBe(4);
  });

  test("empty report (no flagged sessions) still renders a clean header and footer", () => {
    const output = renderTerminal({ sessionsAnalyzed: 3, totalFindings: 0, flaggedSessions: [] });
    expect(output).toContain("sessionlint · 3 sessions analyzed");
    expect(output).toContain("0 findings across 0 flagged sessions");
  });

  test("warning severity uses the ⚠ glyph", () => {
    const output = renderTerminal({
      sessionsAnalyzed: 1,
      totalFindings: 1,
      flaggedSessions: [
        {
          sessionId: "abcdefgh",
          title: null,
          turnCount: 5,
          findings: [
            {
              ruleId: "late-compaction",
              severity: "warning",
              fromTurnNumber: 1,
              toTurnNumber: 1,
              evidence: "test evidence",
            },
          ],
          cost: { estimated: 1 },
        },
      ],
    });
    expect(output).toContain("⚠ LATE-COMPACTION");
  });

  test("no cost-quantified findings: the could-have-been clause is omitted entirely (D-004)", () => {
    const output = renderTerminal({
      sessionsAnalyzed: 1,
      totalFindings: 1,
      flaggedSessions: [
        {
          sessionId: "abcdefgh",
          title: null,
          turnCount: 5,
          findings: [
            {
              ruleId: "late-compaction",
              severity: "warning",
              fromTurnNumber: 1,
              toTurnNumber: 1,
              evidence: "test evidence",
            },
          ],
          cost: { estimated: 1.23 },
        },
      ],
    });
    expect(output).toContain("session cost: $1.23 API-equivalent");
    expect(output).not.toContain("could plausibly have been");
  });
});
