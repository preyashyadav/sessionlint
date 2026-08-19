import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { discoverSessionsAcross, resolveRoots, unscannedRoots, type ConfigRoot } from "./discover";

function rootWith(n: number): { projectsRoot: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "sessionlint-root-"));
  const projectsRoot = join(dir, "projects");
  mkdirSync(join(projectsRoot, "proj"), { recursive: true });
  for (let i = 0; i < n; i++) {
    writeFileSync(join(projectsRoot, "proj", `0000000${i}-0000-0000-0000-000000000000.jsonl`), '{"type":"user"}\n');
  }
  return { projectsRoot, dir };
}

describe("multi-root discovery", () => {
  test("discoverSessionsAcross unions several roots", async () => {
    const a = rootWith(2), b = rootWith(3);
    const found = await discoverSessionsAcross([a.projectsRoot, b.projectsRoot]);
    expect(found.filter((d) => d.kind === "top-level").length).toBe(5);
  });

  test("the same root twice is not double counted", async () => {
    const a = rootWith(2);
    const found = await discoverSessionsAcross([a.projectsRoot, a.projectsRoot]);
    expect(found.length).toBe(2);
  });

  // The whole point of the feature: one unreadable root must not lose the others.
  test("an unreadable root degrades instead of throwing", async () => {
    const a = rootWith(2);
    const found = await discoverSessionsAcross([join(tmpdir(), "definitely-not-here-9128"), a.projectsRoot]);
    expect(found.length).toBe(2);
  });

  test("unscannedRoots reports only roots that hold transcripts and are not read", () => {
    const roots: ConfigRoot[] = [
      { configDir: "/c/a", projectsRoot: "/c/a/projects", label: ".a", transcriptCount: 7, newestMtime: 1, scanned: true },
      { configDir: "/c/b", projectsRoot: "/c/b/projects", label: ".b", transcriptCount: 15, newestMtime: 1, scanned: false },
      { configDir: "/c/c", projectsRoot: "/c/c/projects", label: ".c", transcriptCount: 0, newestMtime: null, scanned: false },
    ];
    const missed = unscannedRoots(roots);
    expect(missed.map((r) => r.label)).toEqual([".b"]);
  });

  describe("resolveRoots", () => {
    test("with no flags, reads only the base root", () => {
      const a = rootWith(1);
      expect(resolveRoots([], a.projectsRoot)).toEqual([a.projectsRoot]);
    });
    test("--add-root accepts a config dir and resolves it to projects/", () => {
      const a = rootWith(1), b = rootWith(1);
      const roots = resolveRoots(["--add-root", b.dir], a.projectsRoot);
      expect(roots).toEqual([a.projectsRoot, b.projectsRoot]);
    });
    test("--add-root also accepts a projects dir directly", () => {
      const a = rootWith(1), b = rootWith(1);
      expect(resolveRoots(["--add-root", b.projectsRoot], a.projectsRoot)).toEqual([a.projectsRoot, b.projectsRoot]);
    });
    test("--add-root twice adds both, without duplicating the base", () => {
      const a = rootWith(1), b = rootWith(1), c = rootWith(1);
      const roots = resolveRoots(["--add-root", b.dir, "--add-root", c.dir], a.projectsRoot);
      expect(roots.length).toBe(3);
      expect(new Set(roots).size).toBe(3);
    });
    test("a dangling --add-root with no value is ignored, not a crash", () => {
      const a = rootWith(1);
      expect(resolveRoots(["--add-root"], a.projectsRoot)).toEqual([a.projectsRoot]);
    });
  });
});
