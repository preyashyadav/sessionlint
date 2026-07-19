import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { appendHandoffNote, renderHandoffNote } from "./handoff-note";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "sessionlint-handoff-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("renderHandoffNote", () => {
  test("includes the reason, stop kind, exit code, and last output lines", () => {
    const rendered = renderHandoffNote({
      timestamp: "2026-07-13T00:00:00.000Z",
      reason: "budget exceeded",
      stoppedGracefully: true,
      exitCode: 0,
      lastOutputLines: ["line one", "line two"],
    });
    expect(rendered).toContain("budget exceeded");
    expect(rendered).toContain("graceful");
    expect(rendered).toContain("> line one");
    expect(rendered).toContain("> line two");
  });

  test("a forced stop is labeled distinctly from a graceful one", () => {
    const rendered = renderHandoffNote({
      timestamp: "2026-07-13T00:00:00.000Z",
      reason: "timeout",
      stoppedGracefully: false,
      exitCode: null,
      lastOutputLines: [],
    });
    expect(rendered).toContain("forced");
    expect(rendered).not.toContain("Last output");
  });
});

describe("appendHandoffNote", () => {
  test("returns false and writes nothing when no plan file exists — a real absence, not an error", async () => {
    await withTempDir(async (dir) => {
      const written = await appendHandoffNote(dir, {
        timestamp: "2026-07-13T00:00:00.000Z",
        reason: "budget exceeded",
        stoppedGracefully: true,
        exitCode: 0,
        lastOutputLines: [],
      });
      expect(written).toBe(false);
    });
  });

  test("appends to an existing TODO.md, preserving prior content", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "TODO.md"), "- [ ] Original item\n");
      const written = await appendHandoffNote(dir, {
        timestamp: "2026-07-13T00:00:00.000Z",
        reason: "budget exceeded",
        stoppedGracefully: true,
        exitCode: 0,
        lastOutputLines: ["last line"],
      });
      expect(written).toBe(true);
      const content = await readFile(join(dir, "TODO.md"), "utf8");
      expect(content).toContain("- [ ] Original item");
      expect(content).toContain("sessionlint handoff");
      expect(content).toContain("last line");
    });
  });
});
