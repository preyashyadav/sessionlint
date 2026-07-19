import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { runSupervised } from "./supervised-run";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "sessionlint-supervised-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("runSupervised", () => {
  test("a natural exit has no stop reason and writes no handoff note, even if a plan file exists", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "TODO.md"), "- [ ] Something\n");
      const handle = runSupervised({ command: ["bash", "-c", "exit 0"], cwd: dir });
      const result = await handle.result;
      expect(result.stopReason).toBeNull();
      expect(result.handoffNoteWritten).toBe(false);
      const content = await readFile(join(dir, "TODO.md"), "utf8");
      expect(content).not.toContain("sessionlint handoff");
    });
  });

  test("a requested stop with a plan file present writes a handoff note with captured output", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "TODO.md"), "- [ ] Something\n");
      // sleep runs in the background + `wait` so the trap actually interrupts it promptly —
      // see the note in process-supervisor.test.ts on bash's foreground-command trap deferral.
      const handle = runSupervised({
        command: ["bash", "-c", "trap 'exit 0' TERM; echo working; sleep 30 & wait \"$!\""],
        cwd: dir,
        gracefulTimeoutMs: 5000,
      });
      // give the child a moment to print its line before stopping it
      await Bun.sleep(200);
      await handle.requestStop("budget exceeded");
      const result = await handle.result;
      expect(result.stopReason).toBe("budget exceeded");
      expect(result.handoffNoteWritten).toBe(true);
      const content = await readFile(join(dir, "TODO.md"), "utf8");
      expect(content).toContain("budget exceeded");
      expect(content).toContain("> working");
    });
  });

  test("a requested stop with no plan file present does not write or error", async () => {
    await withTempDir(async (dir) => {
      const handle = runSupervised({
        command: ["bash", "-c", "trap 'exit 0' TERM; sleep 30 & wait \"$!\""],
        cwd: dir,
        gracefulTimeoutMs: 5000,
      });
      await handle.requestStop("budget exceeded");
      const result = await handle.result;
      expect(result.handoffNoteWritten).toBe(false);
    });
  });

  test("the last-lines ring buffer is capped at maxLastLines", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "TODO.md"), "- [ ] Something\n");
      const handle = runSupervised({
        command: [
          "bash",
          "-c",
          "trap 'exit 0' TERM; for i in $(seq 1 10); do echo line-$i; done; sleep 30 & wait \"$!\"",
        ],
        cwd: dir,
        maxLastLines: 3,
        gracefulTimeoutMs: 5000,
      });
      await Bun.sleep(300);
      await handle.requestStop("stop");
      const result = await handle.result;
      const content = await readFile(join(dir, "TODO.md"), "utf8");
      expect(content).toContain("line-8");
      expect(content).toContain("line-9");
      expect(content).toContain("line-10");
      expect(content).not.toContain("line-7");
      void result;
    });
  });
});
