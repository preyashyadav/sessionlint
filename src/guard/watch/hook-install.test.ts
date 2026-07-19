import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { SettingsParseError } from "../../pilot/delegate-config";
import { defaultHookGateCommand, installWatchHook, readTripState, uninstallWatchHook } from "./hook-install";
import { WATCH_STATE_FILENAME } from "./watch-runner";

async function tempSettingsPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "sessionlint-hook-"));
  return join(dir, ".claude", "settings.local.json");
}

describe("installWatchHook / uninstallWatchHook", () => {
  test("installs the PreToolUse gate group into an empty settings file, idempotently", async () => {
    const path = await tempSettingsPath();
    const command = defaultHookGateCommand("/my/project");

    expect(await installWatchHook(path, command)).toBe(true);
    const settings = JSON.parse(await readFile(path, "utf8"));
    const group = settings.hooks.PreToolUse[0];
    expect(group.matcher).toBe("*");
    expect(group.hooks[0].type).toBe("command");
    expect(group.hooks[0].command).toContain("sessionlint hook-gate");
    expect(group.hooks[0].command).toContain("/my/project");

    // Second install is a no-op, not a duplicate.
    expect(await installWatchHook(path, command)).toBe(false);
    const again = JSON.parse(await readFile(path, "utf8"));
    expect(again.hooks.PreToolUse).toHaveLength(1);
  });

  test("preserves unrelated settings keys and pre-existing foreign hooks", async () => {
    const path = await tempSettingsPath();
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(
      path,
      JSON.stringify({
        env: { FOO: "bar" },
        hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "/other/tool.sh" }] }] },
      })
    );

    await installWatchHook(path, defaultHookGateCommand("/p"));
    const settings = JSON.parse(await readFile(path, "utf8"));
    expect(settings.env.FOO).toBe("bar");
    expect(settings.hooks.PreToolUse).toHaveLength(2);
    expect(settings.hooks.PreToolUse[0].hooks[0].command).toBe("/other/tool.sh");

    // Uninstall removes ONLY ours.
    expect(await uninstallWatchHook(path)).toBe(true);
    const after = JSON.parse(await readFile(path, "utf8"));
    expect(after.hooks.PreToolUse).toHaveLength(1);
    expect(after.hooks.PreToolUse[0].hooks[0].command).toBe("/other/tool.sh");
    expect(await uninstallWatchHook(path)).toBe(false);
  });

  test("a hook installed via a custom --hook-command (from-source form) is still found and removable", async () => {
    // Regression: found live, not by the original unit tests — the exact-marker check
    // couldn't recognize its own hook when installed as "bun run .../index.ts hook-gate ...".
    const path = await tempSettingsPath();
    const custom = 'bun run /repo/sessionlint/index.ts hook-gate --project-dir "/my/project"';

    expect(await installWatchHook(path, custom)).toBe(true);
    expect(await installWatchHook(path, custom)).toBe(false); // idempotent for custom form too
    expect(await uninstallWatchHook(path)).toBe(true);
    const after = JSON.parse(await readFile(path, "utf8"));
    expect(after.hooks).toBeUndefined();
  });

  test("refuses to touch a settings file that isn't valid JSON (same contract as delegate-config)", async () => {
    const path = await tempSettingsPath();
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, "{ not json !!");
    expect(installWatchHook(path, "x")).rejects.toBeInstanceOf(SettingsParseError);
  });
});

describe("readTripState (what hook-gate enforces)", () => {
  test("returns the trip when the watch state file says tripped", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "sessionlint-gate-"));
    await mkdir(join(projectDir, ".sessionlint"), { recursive: true });
    await writeFile(
      join(projectDir, ".sessionlint", WATCH_STATE_FILENAME),
      JSON.stringify({ tripped: true, reason: "identical-diffs", detail: "3 identical turns", at: "2026-07-16T12:00:00Z" })
    );
    const state = await readTripState(projectDir);
    expect(state?.reason).toBe("identical-diffs");
  });

  test("fails OPEN: missing, corrupt, or untripped state all return null", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "sessionlint-gate-"));
    expect(await readTripState(projectDir)).toBeNull(); // missing

    await mkdir(join(projectDir, ".sessionlint"), { recursive: true });
    await writeFile(join(projectDir, ".sessionlint", WATCH_STATE_FILENAME), "corrupt{{{");
    expect(await readTripState(projectDir)).toBeNull(); // corrupt

    await writeFile(join(projectDir, ".sessionlint", WATCH_STATE_FILENAME), JSON.stringify({ tripped: false }));
    expect(await readTripState(projectDir)).toBeNull(); // untripped
  });
});
