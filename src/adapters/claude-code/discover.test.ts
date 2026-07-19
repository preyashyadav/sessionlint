import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { homedir, tmpdir } from "os";
import { defaultRoot, discoverSessions, newestTranscriptMtime } from "./discover";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sessionlint-discover-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("discoverSessions", () => {
  test("empty root: throws neither, returns empty array", async () => {
    const found = await discoverSessions(root);
    expect(found).toEqual([]);
  });

  test("nonexistent root: throws a clear error", async () => {
    await expect(discoverSessions(join(root, "does-not-exist"))).rejects.toThrow(
      "Cannot read"
    );
  });

  test("finds top-level session files and reports sessionId from filename", async () => {
    const projectDir = join(root, "my-project");
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, "session-1.jsonl"), "{}\n");

    const found = await discoverSessions(root);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ sessionId: "session-1", kind: "top-level" });
  });

  test("finds subagent files nested under <session-uuid>/subagents/", async () => {
    const projectDir = join(root, "my-project");
    const sessionDir = join(projectDir, "abc-123");
    const subagentsDir = join(sessionDir, "subagents");
    await mkdir(subagentsDir, { recursive: true });
    await writeFile(join(subagentsDir, "sub-1.jsonl"), "{}\n");

    const found = await discoverSessions(root);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      sessionId: "sub-1",
      kind: "subagent",
      parentSessionId: "abc-123",
    });
  });

  test("skips a 'memory' directory", async () => {
    const projectDir = join(root, "my-project");
    const memoryDir = join(projectDir, "memory");
    await mkdir(memoryDir, { recursive: true });
    await writeFile(join(memoryDir, "note.jsonl"), "{}\n");

    const found = await discoverSessions(root);
    expect(found).toEqual([]);
  });

  test("ignores non-jsonl files", async () => {
    const projectDir = join(root, "my-project");
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, "readme.txt"), "hello");

    const found = await discoverSessions(root);
    expect(found).toEqual([]);
  });
});

describe("defaultRoot honors CLAUDE_CONFIG_DIR (verified live 2026-07-16)", () => {
  const saved = process.env["CLAUDE_CONFIG_DIR"];

  afterEach(() => {
    if (saved === undefined) delete process.env["CLAUDE_CONFIG_DIR"];
    else process.env["CLAUDE_CONFIG_DIR"] = saved;
  });

  test("unset: falls back to ~/.claude/projects", () => {
    delete process.env["CLAUDE_CONFIG_DIR"];
    expect(defaultRoot()).toBe(join(homedir(), ".claude", "projects"));
  });

  test("absolute path: <dir>/projects", () => {
    process.env["CLAUDE_CONFIG_DIR"] = "/opt/claude-tago";
    expect(defaultRoot()).toBe("/opt/claude-tago/projects");
  });

  test("leading tilde is expanded (real observed env carried a literal '~/...')", () => {
    process.env["CLAUDE_CONFIG_DIR"] = "~/.claude-tago";
    expect(defaultRoot()).toBe(join(homedir(), ".claude-tago", "projects"));
  });

  test("empty/whitespace value: treated as unset, never 'projects' in cwd", () => {
    process.env["CLAUDE_CONFIG_DIR"] = "  ";
    expect(defaultRoot()).toBe(join(homedir(), ".claude", "projects"));
  });
});

describe("defaultRoot detects Claude Code's unexpanded-~ misplacement (observed live 2026-07-18, CC 2.1.212)", () => {
  const savedEnv = process.env["CLAUDE_CONFIG_DIR"];
  const savedCwd = process.cwd();
  // A name that cannot exist in the real home dir, so the expanded root is always absent.
  const configName = `.sessionlint-test-misplaced-${process.pid}`;

  afterEach(() => {
    if (savedEnv === undefined) delete process.env["CLAUDE_CONFIG_DIR"];
    else process.env["CLAUDE_CONFIG_DIR"] = savedEnv;
    process.chdir(savedCwd);
  });

  test("TP: literal ./~/<dir>/projects with transcripts wins when the expanded root is absent", async () => {
    process.env["CLAUDE_CONFIG_DIR"] = `~/${configName}`;
    const literalProj = join(root, "~", configName, "projects", "my-project");
    await mkdir(literalProj, { recursive: true });
    await writeFile(join(literalProj, "session-1.jsonl"), "{}\n");
    process.chdir(root);
    // process.cwd() resolves symlinks (macOS /var → /private/var), so anchor to it, not root.
    expect(defaultRoot()).toBe(join(process.cwd(), "~", configName, "projects"));
  });

  test("TN: no literal dir in cwd — expanded home path returned as before", () => {
    process.env["CLAUDE_CONFIG_DIR"] = `~/${configName}`;
    process.chdir(root);
    expect(defaultRoot()).toBe(join(homedir(), configName, "projects"));
  });

  test("TN: literal dir exists but holds no transcripts — expanded home path still wins", async () => {
    process.env["CLAUDE_CONFIG_DIR"] = `~/${configName}`;
    const literalProj = join(root, "~", configName, "projects", "my-project");
    await mkdir(literalProj, { recursive: true });
    await writeFile(join(literalProj, "readme.txt"), "not a transcript");
    process.chdir(root);
    expect(defaultRoot()).toBe(join(homedir(), configName, "projects"));
  });

  test("TN: absolute CLAUDE_CONFIG_DIR never probes cwd", async () => {
    process.env["CLAUDE_CONFIG_DIR"] = "/opt/claude-tago";
    const literalProj = join(root, "~", "opt-decoy", "projects", "p");
    await mkdir(literalProj, { recursive: true });
    await writeFile(join(literalProj, "s.jsonl"), "{}\n");
    process.chdir(root);
    expect(defaultRoot()).toBe("/opt/claude-tago/projects");
  });
});

describe("newestTranscriptMtime", () => {
  test("unreadable root: null", () => {
    expect(newestTranscriptMtime(join(root, "nope"))).toBeNull();
  });

  test("no transcripts anywhere: null", async () => {
    await mkdir(join(root, "proj"), { recursive: true });
    await writeFile(join(root, "proj", "readme.txt"), "x");
    expect(newestTranscriptMtime(root)).toBeNull();
  });

  test("picks the newest .jsonl across project dirs", async () => {
    const { utimes } = await import("fs/promises");
    await mkdir(join(root, "a"), { recursive: true });
    await mkdir(join(root, "b"), { recursive: true });
    await writeFile(join(root, "a", "old.jsonl"), "{}\n");
    await writeFile(join(root, "b", "new.jsonl"), "{}\n");
    await utimes(join(root, "a", "old.jsonl"), new Date(1000000), new Date(1000000));
    const newTime = new Date();
    await utimes(join(root, "b", "new.jsonl"), newTime, newTime);
    expect(newestTranscriptMtime(root)).toBe(newTime.getTime());
  });
});
