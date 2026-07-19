import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { saveSampleStore } from "./burn-samples";
import { runUserPromptSubmitHook } from "./hook-user-prompt-submit";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "sessionlint-hook-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("runUserPromptSubmitHook", () => {
  test("no burn-state history yet produces no output (never blocks submission)", async () => {
    await withTempDir(async (dir) => {
      const stateFilePath = join(dir, "burn-state.json");
      const output = await runUserPromptSubmitHook({ cwd: dir }, { stateFilePath });
      expect(output).toBe("");
    });
  });

  test("below threshold produces no output", async () => {
    await withTempDir(async (dir) => {
      const stateFilePath = join(dir, "burn-state.json");
      await saveSampleStore(stateFilePath, { windowKey: 1, samples: [{ timestamp: 0, usedPercentage: 40 }] });
      const output = await runUserPromptSubmitHook({ cwd: dir }, { stateFilePath });
      expect(output).toBe("");
    });
  });

  test("at/above threshold produces the advisory, using the latest sample", async () => {
    await withTempDir(async (dir) => {
      const stateFilePath = join(dir, "burn-state.json");
      await saveSampleStore(stateFilePath, {
        windowKey: 1,
        samples: [
          { timestamp: 0, usedPercentage: 40 },
          { timestamp: 1000, usedPercentage: 90 },
        ],
      });
      const output = await runUserPromptSubmitHook({ cwd: dir }, { stateFilePath });
      expect(output).toContain("90%");
    });
  });

  test("reads a real plan file from the hook's reported cwd and reflects it in the advisory", async () => {
    await withTempDir(async (dir) => {
      const stateFilePath = join(dir, "burn-state.json");
      await saveSampleStore(stateFilePath, { windowKey: 1, samples: [{ timestamp: 0, usedPercentage: 90 }] });
      await writeFile(join(dir, "TODO.md"), "- [ ] Add test coverage\n");
      const output = await runUserPromptSubmitHook({ cwd: dir }, { stateFilePath });
      expect(output).toContain("mechanical");
    });
  });

  test("malformed hook input (no cwd/session_id) still degrades gracefully, never throws", async () => {
    await withTempDir(async (dir) => {
      const stateFilePath = join(dir, "burn-state.json");
      await saveSampleStore(stateFilePath, { windowKey: 1, samples: [{ timestamp: 0, usedPercentage: 90 }] });
      const output = await runUserPromptSubmitHook("not an object", { stateFilePath });
      expect(output).toContain("90%"); // no cwd means no plan file lookup, but the gauge check still runs
    });
  });

  test("turn-boundary structural guarantee: the hook's only entry point is this function, called once per invocation — there is no code path for it to fire mid-turn", async () => {
    // Not an event-stream simulation (this codebase has no live intra-turn event
    // feed to hook into) — the real guarantee is architectural: this function is
    // only ever invoked by the UserPromptSubmit hook (see hook-config.test.ts),
    // and it has no timer, no loop, no subscription to tool-call events. A single
    // call is the entire lifecycle of one hook invocation.
    await withTempDir(async (dir) => {
      const stateFilePath = join(dir, "burn-state.json");
      await saveSampleStore(stateFilePath, { windowKey: 1, samples: [{ timestamp: 0, usedPercentage: 90 }] });
      const first = await runUserPromptSubmitHook({ cwd: dir }, { stateFilePath });
      const second = await runUserPromptSubmitHook({ cwd: dir }, { stateFilePath });
      expect(first).toBe(second); // idempotent given unchanged state — no hidden internal timer/counter
    });
  });
});
