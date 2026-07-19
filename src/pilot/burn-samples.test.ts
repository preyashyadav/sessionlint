import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { loadSampleStore, recordSample, saveSampleStore, SLIDING_WINDOW_MS } from "./burn-samples";

describe("recordSample", () => {
  test("first sample with no existing store starts a fresh window", () => {
    const result = recordSample(null, 100, { timestamp: 1000, usedPercentage: 5 });
    expect(result).toEqual({ windowKey: 100, samples: [{ timestamp: 1000, usedPercentage: 5 }] });
  });

  test("same window key appends to existing samples", () => {
    const existing = { windowKey: 100, samples: [{ timestamp: 1000, usedPercentage: 5 }] };
    const result = recordSample(existing, 100, { timestamp: 2000, usedPercentage: 8 });
    expect(result.samples).toEqual([
      { timestamp: 1000, usedPercentage: 5 },
      { timestamp: 2000, usedPercentage: 8 },
    ]);
  });

  test("a new window key (server-side reset) discards prior samples", () => {
    const existing = { windowKey: 100, samples: [{ timestamp: 1000, usedPercentage: 90 }] };
    const result = recordSample(existing, 200, { timestamp: 2000, usedPercentage: 1 });
    expect(result).toEqual({ windowKey: 200, samples: [{ timestamp: 2000, usedPercentage: 1 }] });
  });

  test("samples older than the sliding window are pruned", () => {
    const existing = {
      windowKey: 100,
      samples: [
        { timestamp: 0, usedPercentage: 1 },
        { timestamp: SLIDING_WINDOW_MS - 1000, usedPercentage: 2 },
      ],
    };
    const newTimestamp = SLIDING_WINDOW_MS + 5000;
    const result = recordSample(existing, 100, { timestamp: newTimestamp, usedPercentage: 3 });
    expect(result.samples).toEqual([
      { timestamp: SLIDING_WINDOW_MS - 1000, usedPercentage: 2 },
      { timestamp: newTimestamp, usedPercentage: 3 },
    ]);
  });
});

describe("loadSampleStore / saveSampleStore", () => {
  test("round-trips through disk, and a missing file returns null instead of throwing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sessionlint-burn-"));
    const path = join(dir, "nested", "burn-state.json");
    try {
      expect(await loadSampleStore(path)).toBeNull();
      const state = { windowKey: 42, samples: [{ timestamp: 1, usedPercentage: 1 }] };
      await saveSampleStore(path, state);
      expect(await loadSampleStore(path)).toEqual(state);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("corrupt file on disk degrades to null, not a crash", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sessionlint-burn-"));
    const path = join(dir, "burn-state.json");
    try {
      await Bun.write(path, "{not valid json");
      expect(await loadSampleStore(path)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
