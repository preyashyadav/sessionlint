import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { runAutoDelegateOff, runAutoDelegateOn } from "./auto-delegate";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "sessionlint-autodel-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("runAutoDelegateOn / runAutoDelegateOff", () => {
  test("enabling is honest about NOT taking effect this session", async () => {
    await withTempDir(async (dir) => {
      const settingsPath = join(dir, "settings.local.json");
      const auditLogPath = join(dir, "audit-log.jsonl");
      const message = await runAutoDelegateOn("haiku", { settingsPath, auditLogPath });
      expect(message).toContain("NEXT Claude Code session");
      expect(message).toContain("haiku");
    });
  });

  test("enabling appends an audit log entry", async () => {
    await withTempDir(async (dir) => {
      const settingsPath = join(dir, "settings.local.json");
      const auditLogPath = join(dir, "audit-log.jsonl");
      await runAutoDelegateOn("haiku", { settingsPath, auditLogPath, now: () => new Date("2026-07-12T00:00:00Z") });
      const log = (await readFile(auditLogPath, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
      expect(log).toHaveLength(1);
      expect(log[0]).toEqual({
        timestamp: "2026-07-12T00:00:00.000Z",
        action: "auto-delegate-enable",
        detail: { model: "haiku", settingsPath },
      });
    });
  });

  test("disabling after enabling logs the previous model and is reversible", async () => {
    await withTempDir(async (dir) => {
      const settingsPath = join(dir, "settings.local.json");
      const auditLogPath = join(dir, "audit-log.jsonl");
      await runAutoDelegateOn("haiku", { settingsPath, auditLogPath });
      const message = await runAutoDelegateOff({ settingsPath, auditLogPath });
      expect(message).toContain("disabled");

      const log = (await readFile(auditLogPath, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
      expect(log).toHaveLength(2);
      expect(log[1].action).toBe("auto-delegate-disable");
      expect(log[1].detail.previousModel).toBe("haiku");
    });
  });

  test("disabling when never enabled says so rather than claiming a fake success", async () => {
    await withTempDir(async (dir) => {
      const settingsPath = join(dir, "settings.local.json");
      const auditLogPath = join(dir, "audit-log.jsonl");
      const message = await runAutoDelegateOff({ settingsPath, auditLogPath });
      expect(message).toContain("already off");
    });
  });
});
