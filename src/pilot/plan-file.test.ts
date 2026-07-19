import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { readPlanItems } from "./plan-file";

describe("readPlanItems", () => {
  test("returns null when no recognized plan file exists — a real absence, not an error", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sessionlint-plan-"));
    try {
      expect(await readPlanItems(dir)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("reads TODO.md when present", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sessionlint-plan-"));
    try {
      await writeFile(join(dir, "TODO.md"), "- [ ] Refactor the module\n");
      const items = await readPlanItems(dir);
      expect(items).toEqual([{ text: "Refactor the module", classification: "heavy" }]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("falls back to plan.md when TODO.md is absent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sessionlint-plan-"));
    try {
      await writeFile(join(dir, "plan.md"), "- [ ] Add test coverage\n");
      const items = await readPlanItems(dir);
      expect(items).toEqual([{ text: "Add test coverage", classification: "mechanical" }]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
