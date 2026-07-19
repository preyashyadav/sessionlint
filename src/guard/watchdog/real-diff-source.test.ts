import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { buildTestOutputSignature, realDiffSource } from "./real-diff-source";

async function runGit(cwd: string, args: string[]): Promise<void> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "ignore", stderr: "ignore" });
  await proc.exited;
}

describe("realDiffSource", () => {
  test("no `from` commit returns an empty diff, not an error", async () => {
    expect(await realDiffSource.diffBetween("/tmp", null, "HEAD")).toBe("");
  });

  test("returns the real diff text between two real commits", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sessionlint-diffsrc-"));
    try {
      await runGit(dir, ["init", "-q"]);
      await runGit(dir, ["config", "user.email", "test@example.com"]);
      await runGit(dir, ["config", "user.name", "Test"]);
      await writeFile(join(dir, "a.txt"), "one\n");
      await runGit(dir, ["add", "."]);
      await runGit(dir, ["commit", "-q", "-m", "first"]);
      const firstProc = Bun.spawn(["git", "rev-parse", "HEAD"], { cwd: dir, stdout: "pipe" });
      const first = (await new Response(firstProc.stdout).text()).trim();
      await firstProc.exited;

      await writeFile(join(dir, "a.txt"), "two\n");
      await runGit(dir, ["add", "."]);
      await runGit(dir, ["commit", "-q", "-m", "second"]);
      const secondProc = Bun.spawn(["git", "rev-parse", "HEAD"], { cwd: dir, stdout: "pipe" });
      const second = (await new Response(secondProc.stdout).text()).trim();
      await secondProc.exited;

      const diff = await realDiffSource.diffBetween(dir, first, second);
      expect(diff).toContain("-one");
      expect(diff).toContain("+two");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("buildTestOutputSignature", () => {
  test("truncates to the first few lines", () => {
    const output = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const signature = buildTestOutputSignature(output);
    expect(signature.split("\n")).toHaveLength(5);
    expect(signature).toContain("line 0");
    expect(signature).not.toContain("line 10");
  });

  test("identical leading output produces identical signatures even if trailing output differs", () => {
    const a = "same error\nat foo.ts:1\nat bar.ts:2\nat baz.ts:3\nat qux.ts:4\nDIFFERENT TRAILING A";
    const b = "same error\nat foo.ts:1\nat bar.ts:2\nat baz.ts:3\nat qux.ts:4\nDIFFERENT TRAILING B";
    expect(buildTestOutputSignature(a)).toBe(buildTestOutputSignature(b));
  });
});
