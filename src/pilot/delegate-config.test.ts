import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  disableAutoDelegate,
  enableAutoDelegate,
  readAutoDelegateModel,
  SettingsParseError,
} from "./delegate-config";

async function withTempSettingsPath(fn: (path: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "sessionlint-delegate-"));
  try {
    await fn(join(dir, ".claude", "settings.local.json"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("enableAutoDelegate / disableAutoDelegate / readAutoDelegateModel", () => {
  test("enabling on a missing file creates it with just the one key", async () => {
    await withTempSettingsPath(async (path) => {
      await enableAutoDelegate(path, "haiku");
      const written = JSON.parse(await readFile(path, "utf8"));
      expect(written).toEqual({ env: { CLAUDE_CODE_SUBAGENT_MODEL: "haiku" } });
      expect(await readAutoDelegateModel(path)).toBe("haiku");
    });
  });

  test("enabling preserves unrelated top-level keys and other env vars", async () => {
    await withTempSettingsPath(async (path) => {
      const { mkdir } = await import("fs/promises");
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(
        path,
        JSON.stringify({ permissions: { allow: ["Bash(git *)"] }, env: { SOME_OTHER_VAR: "1" } }, null, 2)
      );
      await enableAutoDelegate(path, "haiku");
      const written = JSON.parse(await readFile(path, "utf8"));
      expect(written).toEqual({
        permissions: { allow: ["Bash(git *)"] },
        env: { SOME_OTHER_VAR: "1", CLAUDE_CODE_SUBAGENT_MODEL: "haiku" },
      });
    });
  });

  test("disabling removes only the one key, preserving other env vars", async () => {
    await withTempSettingsPath(async (path) => {
      await enableAutoDelegate(path, "haiku");
      const { mkdir } = await import("fs/promises");
      await mkdir(join(path, ".."), { recursive: true });
      const current = JSON.parse(await readFile(path, "utf8"));
      current.env.SOME_OTHER_VAR = "1";
      await writeFile(path, JSON.stringify(current, null, 2));

      await disableAutoDelegate(path);
      const written = JSON.parse(await readFile(path, "utf8"));
      expect(written).toEqual({ env: { SOME_OTHER_VAR: "1" } });
    });
  });

  test("disabling removes the whole env object if it becomes empty", async () => {
    await withTempSettingsPath(async (path) => {
      await enableAutoDelegate(path, "haiku");
      await disableAutoDelegate(path);
      const written = JSON.parse(await readFile(path, "utf8"));
      expect(written).toEqual({});
    });
  });

  test("disabling when never enabled is a no-op, not an error", async () => {
    await withTempSettingsPath(async (path) => {
      await disableAutoDelegate(path);
      expect(await readAutoDelegateModel(path)).toBeNull();
    });
  });

  test("a settings file that isn't valid JSON is refused, not corrupted", async () => {
    await withTempSettingsPath(async (path) => {
      const { mkdir } = await import("fs/promises");
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, "{ not valid json");
      await expect(enableAutoDelegate(path, "haiku")).rejects.toThrow(SettingsParseError);
      // the original corrupt content must be untouched
      expect(await readFile(path, "utf8")).toBe("{ not valid json");
    });
  });
});
