import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { getHeadCommit } from "./git-iterations";

async function runGit(cwd: string, args: string[]): Promise<void> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "ignore", stderr: "ignore" });
  await proc.exited;
}

describe("getHeadCommit", () => {
  test("a non-git directory returns null, not an error", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sessionlint-git-"));
    try {
      expect(await getHeadCommit(dir)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a git repo with no commits yet returns null", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sessionlint-git-"));
    try {
      await runGit(dir, ["init", "-q"]);
      expect(await getHeadCommit(dir)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a repo with a commit returns its real commit hash, and a new commit changes it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sessionlint-git-"));
    try {
      await runGit(dir, ["init", "-q"]);
      await runGit(dir, ["config", "user.email", "test@example.com"]);
      await runGit(dir, ["config", "user.name", "Test"]);
      await writeFile(join(dir, "a.txt"), "one");
      await runGit(dir, ["add", "."]);
      await runGit(dir, ["commit", "-q", "-m", "first"]);
      const first = await getHeadCommit(dir);
      expect(first).toMatch(/^[0-9a-f]{40}$/);

      await writeFile(join(dir, "a.txt"), "two");
      await runGit(dir, ["add", "."]);
      await runGit(dir, ["commit", "-q", "-m", "second"]);
      const second = await getHeadCommit(dir);
      expect(second).toMatch(/^[0-9a-f]{40}$/);
      expect(second).not.toBe(first);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
