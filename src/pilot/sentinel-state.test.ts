import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { loadSentinelState, markThresholdsFired, saveSentinelState } from "./sentinel-state";

async function withTempPath(fn: (path: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "sessionlint-sentinel-"));
  try {
    await fn(join(dir, "state.json"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("sentinel-state", () => {
  test("missing file loads as empty state, not an error", async () => {
    await withTempPath(async (path) => {
      expect(await loadSentinelState(path)).toEqual({});
    });
  });

  test("markThresholdsFired merges and dedupes per session", () => {
    const state = markThresholdsFired({}, "sess-1", [50]);
    const updated = markThresholdsFired(state, "sess-1", [50, 80]);
    expect(updated).toEqual({ "sess-1": [50, 80] });
  });

  test("different sessions are tracked independently", () => {
    let state = markThresholdsFired({}, "sess-1", [50]);
    state = markThresholdsFired(state, "sess-2", [95]);
    expect(state).toEqual({ "sess-1": [50], "sess-2": [95] });
  });

  test("round-trips through disk", async () => {
    await withTempPath(async (path) => {
      const state = markThresholdsFired({}, "sess-1", [50, 80]);
      await saveSentinelState(path, state);
      expect(await loadSentinelState(path)).toEqual(state);
    });
  });

  test("corrupt file degrades to empty state, not a crash", async () => {
    await withTempPath(async (path) => {
      await Bun.write(path, "not valid json");
      expect(await loadSentinelState(path)).toEqual({});
    });
  });
});
