import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { runStatusline } from "./statusline";

const RANGE_COUNTDOWN = /wall in ~\d+-\d+min\b/;
const POINT_ESTIMATE_COUNTDOWN = /wall in ~?\d+min\b/;

async function withTempState(fn: (statePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "sessionlint-statusline-"));
  try {
    await fn(join(dir, "burn-state.json"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("runStatusline", () => {
  test("no rate_limits at all degrades gracefully, no crash", async () => {
    await withTempState(async (stateFilePath) => {
      const output = await runStatusline({ session_id: "abc" }, { stateFilePath });
      expect(output).toBe("sessionlint: quota data unavailable this turn");
    });
  });

  test("malformed stdin JSON body degrades gracefully", async () => {
    await withTempState(async (stateFilePath) => {
      const output = await runStatusline("not an object", { stateFilePath });
      expect(output).toBe("sessionlint: quota data unavailable this turn");
    });
  });

  test("first invocation of a window has no rate yet — 'collecting', not a forecast", async () => {
    await withTempState(async (stateFilePath) => {
      const input = { rate_limits: { five_hour: { used_percentage: 5, resets_at: 999_999_999 } } };
      const output = await runStatusline(input, { stateFilePath, nowMs: () => 0 });
      expect(output).toContain("collecting burn-rate data");
      expect(output).not.toMatch(POINT_ESTIMATE_COUNTDOWN);
    });
  });

  test("second invocation, same window, later timestamp: produces a real forecast range", async () => {
    await withTempState(async (stateFilePath) => {
      const resetsAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour out
      await runStatusline(
        { rate_limits: { five_hour: { used_percentage: 5, resets_at: resetsAt } } },
        { stateFilePath, nowMs: () => 0 }
      );
      const output = await runStatusline(
        { rate_limits: { five_hour: { used_percentage: 15, resets_at: resetsAt } } },
        { stateFilePath, nowMs: () => 5 * 60_000 } // 5 minutes later, +10%
      );
      expect(output).toMatch(RANGE_COUNTDOWN);
      expect(output).not.toMatch(POINT_ESTIMATE_COUNTDOWN);
      expect(output).toContain("15%");
    });
  });

  test("a resets_at change mid-run starts a fresh window instead of mixing samples", async () => {
    await withTempState(async (stateFilePath) => {
      await runStatusline(
        { rate_limits: { five_hour: { used_percentage: 90, resets_at: 100 } } },
        { stateFilePath, nowMs: () => 0 }
      );
      // New window (server-side reset) — should read as a fresh "collecting" state,
      // not extrapolate a rate from the old window's 90% down to the new window's 1%.
      const output = await runStatusline(
        { rate_limits: { five_hour: { used_percentage: 1, resets_at: 200 } } },
        { stateFilePath, nowMs: () => 1000 }
      );
      expect(output).toContain("collecting burn-rate data");
    });
  });
});
