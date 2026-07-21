import { describe, expect, test } from "bun:test";
import { readFile } from "fs/promises";
import { readdirSync } from "fs";
import { join } from "path";
import { parseSessionFile } from "./parse";
import { buildSession } from "./turns";

const SYNTHETIC_DIR = join(import.meta.dir, "..", "..", "..", "fixtures", "synthetic");
const REAL_FIXTURES_DIR = join(import.meta.dir, "..", "..", "..", "fixtures");

// The sanitized real-transcript fixtures are local-only (never published — they derive from
// real Claude Code history). Tests that assert against them run at full strength locally and
// skip honestly in the public/CI checkout where those fixtures are absent. Synthetic-fixture
// tests below always run.
const hasRealFixtures = (() => {
  try {
    return readdirSync(REAL_FIXTURES_DIR).some((f) => f.endsWith(".jsonl"));
  } catch {
    return false;
  }
})();

async function loadAndBuild(filePath: string) {
  const parsed = await parseSessionFile(filePath);
  return buildSession({
    filePath,
    sessionIdHint: null,
    rawEntries: parsed.lines,
    parseErrorCount: parsed.parseErrorCount,
  });
}

describe("buildSession: minimal-session.jsonl", () => {
  test("one turn, one valid model, no switches", async () => {
    const { session } = await loadAndBuild(join(SYNTHETIC_DIR, "minimal-session.jsonl"));
    expect(session.turns).toHaveLength(1);
    expect(session.turns[0]?.model).toBe("claude-sonnet-5");
    expect(session.turns[0]?.modelValid).toBe(true);
    expect(session.turns[0]?.turnIdSource).toBe("prompt-id");
    expect(session.modelSwitches).toEqual([]);
    expect(session.parseErrorCount).toBe(0);
  });
});

describe("buildSession: multi-block-response.jsonl (usage dedupe)", () => {
  // TP: one API response written across 3 JSONL lines (thinking + 2x tool_use), each line
  // repeating the FULL identical usage bag — the real Claude Code shape. Before the dedupe,
  // buildUsage summed all 3 and inflated this turn ~3x. Every synthetic fixture prior to this
  // one was single-API-call-per-turn, which is why the bug survived the whole suite.
  test("counts one API response once, not once per content block", async () => {
    const { session } = await loadAndBuild(join(SYNTHETIC_DIR, "multi-block-response.jsonl"));
    expect(session.turns).toHaveLength(1);
    const usage = session.turns[0]?.usage;

    // msg_A counted once (not 3x) + msg_B once.
    expect(usage?.outputTokens).toBe(839 + 200);
    expect(usage?.cacheReadInputTokens).toBe(19_595 + 21_000);
    expect(usage?.inputTokens).toBe(10 + 5);
    expect(usage?.cacheCreationInputTokens).toBe(100 + 50);

    // The raw bag array is what the cost engine's cache-write breakdown reads —
    // it must be deduped too, or 5m/1h cache writes inflate independently.
    expect(usage?.raw).toHaveLength(2);
  });

  // TN: the 3 duplicate lines are still real entries and must remain visible to every
  // NON-billing consumer — 2 distinct tool_use blocks are 2 genuine reads, not duplicates.
  test("deduping usage does not hide distinct content blocks from other consumers", async () => {
    const { session } = await loadAndBuild(join(SYNTHETIC_DIR, "multi-block-response.jsonl"));
    expect(session.turns[0]?.content.toolUseNames).toEqual(["Read", "Read"]);
    expect(session.turns[0]?.entries.length).toBeGreaterThan(2);
  });
});

describe("buildSession: model-switch.jsonl", () => {
  test("two turns, exactly one model switch fires", async () => {
    const { session } = await loadAndBuild(join(SYNTHETIC_DIR, "model-switch.jsonl"));
    expect(session.turns).toHaveLength(2);
    expect(session.turns[0]?.model).toBe("claude-opus-4-8");
    expect(session.turns[1]?.model).toBe("claude-sonnet-5");
    expect(session.modelSwitches).toHaveLength(1);
    expect(session.modelSwitches[0]).toMatchObject({
      fromModel: "claude-opus-4-8",
      toModel: "claude-sonnet-5",
    });
  });
});

describe("buildSession: corrupt-line.jsonl", () => {
  test("skips the bad line, still reconstructs the surrounding turn", async () => {
    const { session } = await loadAndBuild(join(SYNTHETIC_DIR, "corrupt-line.jsonl"));
    expect(session.parseErrorCount).toBe(1);
    expect(session.turns).toHaveLength(1);
    expect(session.turns[0]?.model).toBe("claude-sonnet-5");
  });
});

describe("buildSession: unknown-entry-type.jsonl", () => {
  test("retains the unknown entry, counts it, never throws", async () => {
    const { session } = await loadAndBuild(join(SYNTHETIC_DIR, "unknown-entry-type.jsonl"));
    expect(session.unknownTypeCounts).toEqual({ "future-feature-xyz": 1 });
    expect(session.entryCount).toBe(3);
  });
});

describe("buildSession: missing-prompt-id.jsonl", () => {
  test("falls back to parent-chain grouping, synthesizes turns at real human messages", async () => {
    const { session, usedTurnGroupingFallback } = await loadAndBuild(
      join(SYNTHETIC_DIR, "missing-prompt-id.jsonl")
    );
    expect(usedTurnGroupingFallback).toBe(true);
    // Two real human messages ("Read foo.ts...", "Now add a test for it") -> two turns.
    expect(session.turns).toHaveLength(2);
    expect(session.turns.every((t) => t.turnIdSource === "parent-chain-fallback")).toBe(true);
    // First turn: user -> assistant(tool_use) -> user(tool_result) -> assistant(text). Second turn starts fresh.
    expect(session.turns[0]?.entries).toHaveLength(4);
    expect(session.turns[1]?.entries).toHaveLength(2);
  });
});

describe.skipIf(!hasRealFixtures)("buildSession: real fixture with a corrupted assistant-error entry", () => {
  test("917c012e fixture: error entry excluded from model-switch signal", async () => {
    const filePath = join(REAL_FIXTURES_DIR, "917c012e-2980-4a86-bf24-5cb62df8a942.jsonl");
    const { session, invalidModelCount } = await loadAndBuild(filePath);

    expect(invalidModelCount).toBeGreaterThanOrEqual(1);

    // The turn containing the corrupted entry is the one whose last assistant entry is that error.
    const errorTurn = session.turns.find((t) => t.entries.some((e) => e.kind === "assistant-error"));
    expect(errorTurn).toBeDefined();
    expect(errorTurn?.modelValid).toBe(false);
    expect(errorTurn?.modelRaw).toBe("lorem ipsum dolor sit amet consectetur a");

    // That invalid model must never appear as a fromModel/toModel in any switch.
    for (const sw of session.modelSwitches) {
      expect(sw.fromModel).not.toBe("lorem ipsum dolor sit amet consectetur a");
      expect(sw.toModel).not.toBe("lorem ipsum dolor sit amet consectetur a");
    }
  });
});

describe.skipIf(!hasRealFixtures)("buildSession: all 7 real fixtures parse without throwing", () => {
  const realFixtures = [
    "2d946943-68ff-45a5-a9f9-e2d1f8d750fb.jsonl",
    "3ead19a3-1577-434d-ba32-47c012fbb293.jsonl",
    "74761b0d-5a0a-4d3d-9dee-afe26407f19b.jsonl",
    "7a14d3a3-3d46-4462-91fb-bf82427707dc.jsonl",
    "917c012e-2980-4a86-bf24-5cb62df8a942.jsonl",
    "c0ba3e6a-5ec6-4297-a165-5da8a0ba0c83.jsonl",
    "fc6a6002-39e4-420c-b10c-490c739524d2.jsonl",
  ];

  for (const name of realFixtures) {
    test(`${name}: builds a session with >=1 turn, no crash`, async () => {
      const filePath = join(REAL_FIXTURES_DIR, name);
      const { session } = await loadAndBuild(filePath);
      expect(session.turns.length).toBeGreaterThan(0);
      expect(session.sessionId).toBe(name.replace(".jsonl", ""));
    });
  }
});

// Sanity check on the fixture file itself, independent of the adapter, so a future
// fixture-corpus change that breaks this assumption is caught immediately.
test.skipIf(!hasRealFixtures)("sanity: real fixture files exist and are non-empty", async () => {
  const content = await readFile(join(REAL_FIXTURES_DIR, "2d946943-68ff-45a5-a9f9-e2d1f8d750fb.jsonl"), "utf-8");
  expect(content.length).toBeGreaterThan(0);
});
