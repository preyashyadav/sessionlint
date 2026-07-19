import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { costSince, encodeProjectPath } from "./project-cost";

function entry(overrides: Record<string, unknown>): string {
  return JSON.stringify({
    type: "user",
    sessionId: "s1",
    version: "2.1.999",
    promptId: "prompt-1",
    uuid: "u1",
    parentUuid: null,
    isSidechain: false,
    timestamp: "2026-07-13T00:00:00.000Z",
    message: { role: "user", content: "hi" },
    userType: "external",
    entrypoint: "cli",
    cwd: "/x",
    gitBranch: "main",
    ...overrides,
  });
}

function assistantEntry(timestamp: string, uuid: string, parentUuid: string, inputTokens: number, outputTokens: number): string {
  // promptId: undefined is deliberate — real assistant entries never carry their own
  // promptId (verified against real fixtures, MASTER.md §7); they resolve their turn by
  // walking parentUuid. JSON.stringify drops undefined-valued keys, so this correctly
  // omits the field rather than inheriting entry()'s default "prompt-1".
  return entry({
    type: "assistant",
    uuid,
    parentUuid,
    promptId: undefined,
    timestamp,
    message: {
      model: "claude-sonnet-5",
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: inputTokens, output_tokens: outputTokens, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  });
}

describe("encodeProjectPath", () => {
  test("replaces every slash with a dash, matching the observed real convention", () => {
    expect(encodeProjectPath("/Users/x/project")).toBe("-Users-x-project");
  });
});

describe("costSince", () => {
  test("no matching project directory at all reports dataFound: false, not a fabricated $0", async () => {
    const root = await mkdtemp(join(tmpdir(), "sessionlint-claudeproj-"));
    try {
      const result = await costSince("/no/such/project", 0, root);
      expect(result).toEqual({ costUsd: 0, dataFound: false });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("only counts turns at or after the given timestamp", async () => {
    const root = await mkdtemp(join(tmpdir(), "sessionlint-claudeproj-"));
    try {
      const projectDir = "/Users/x/project";
      const encodedDir = join(root, encodeProjectPath(projectDir));
      await mkdir(encodedDir, { recursive: true });
      const lines = [
        entry({ uuid: "u1", timestamp: "2026-07-13T00:00:00.000Z" }),
        assistantEntry("2026-07-13T00:00:01.000Z", "a1", "u1", 1_000_000, 0), // before cutoff — excluded
        entry({ uuid: "u2", parentUuid: "a1", promptId: "prompt-2", timestamp: "2026-07-13T01:00:00.000Z" }),
        assistantEntry("2026-07-13T01:00:01.000Z", "a2", "u2", 1_000_000, 0), // at/after cutoff — included
      ];
      await writeFile(join(encodedDir, "session1.jsonl"), lines.join("\n") + "\n");

      const cutoffMs = new Date("2026-07-13T00:30:00.000Z").getTime();
      const result = await costSince(projectDir, cutoffMs, root);
      expect(result.dataFound).toBe(true);
      // claude-sonnet-5 input rate is $2/MTok (src/pricing/table.ts) — 1M input tokens = $2.00
      expect(result.costUsd).toBeCloseTo(2.0, 2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a directory with no .jsonl files reports dataFound: false", async () => {
    const root = await mkdtemp(join(tmpdir(), "sessionlint-claudeproj-"));
    try {
      const projectDir = "/Users/x/empty-project";
      await mkdir(join(root, encodeProjectPath(projectDir)), { recursive: true });
      const result = await costSince(projectDir, 0, root);
      expect(result).toEqual({ costUsd: 0, dataFound: false });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
