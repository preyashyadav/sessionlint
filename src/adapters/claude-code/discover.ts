/**
 * Session discovery: walks ~/.claude/projects for top-level session JSONL
 * files and subagent JSONL files nested under <session-uuid>/subagents/.
 */

import { readdir, stat } from "fs/promises";
import { readdirSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface DiscoveredSession {
  filePath: string;
  sessionId: string | null;
  kind: "top-level" | "subagent";
  parentSessionId?: string;
}

/** Newest top-level transcript mtime (ms) under a projects root, or null when the root is
 * unreadable or holds no transcripts. Sync and shallow (projects/<proj>/*.jsonl only) —
 * this is a freshness probe for root selection, not a discovery pass. */
export function newestTranscriptMtime(root: string): number | null {
  let newest: number | null = null;
  let projDirs: string[];
  try {
    projDirs = readdirSync(root);
  } catch {
    return null;
  }
  for (const proj of projDirs) {
    let entries: string[];
    try {
      entries = readdirSync(join(root, proj));
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".jsonl")) continue;
      try {
        const mtime = statSync(join(root, proj, entry)).mtimeMs;
        if (newest === null || mtime > newest) newest = mtime;
      } catch {
        /* file vanished mid-probe — ignore */
      }
    }
  }
  return newest;
}

let warnedMisplacedRoot = false;

function warnMisplacedRoot(literalRoot: string, expandedRoot: string, reading: string): void {
  if (warnedMisplacedRoot) return;
  warnedMisplacedRoot = true;
  process.stderr.write(
    [
      `⚠ CLAUDE_CONFIG_DIR starts with "~" and Claude Code did not expand it — it wrote`,
      `  transcripts into a literal "~" directory inside this project:`,
      `    ${literalRoot}`,
      `  sessionlint is reading ${reading}. To fix permanently:`,
      `    1. set CLAUDE_CONFIG_DIR to an absolute path (e.g. ${expandedRoot.replace(/\/projects$/, "")})`,
      `    2. merge the misplaced data:  rsync -a "<literal ~ dir>/" "<real config dir>/"`,
      `    3. delete the literal dir — QUOTE IT:  rm -rf "./~"`,
      ``,
    ].join("\n")
  );
}

/** Honors CLAUDE_CONFIG_DIR, including Claude Code's own failure mode around it.
 *
 * Observed live 2026-07-18 (Claude Code 2.1.212, per the transcripts' version field):
 * Claude Code does NOT expand a leading "~" in CLAUDE_CONFIG_DIR — a value injected
 * verbatim (e.g. by VS Code's terminal.integrated.env) is treated as a path relative to
 * the session's cwd, so transcripts land in a literal "./~/<config-dir>/projects/"
 * directory inside the repo. Older transcripts from the same machine sit in the real
 * home-dir location, so neither location alone is trustworthy.
 *
 * Resolution order: expand "~" to the home dir as the canonical root; when the value
 * starts with "~", also probe the cwd-relative literal path. If the literal root holds
 * the freshest transcripts, read from there (that's where the user's active Claude Code
 * is actually writing) and print a one-time stderr warning with the permanent fix. */
export function defaultRoot(): string {
  const configDir = process.env["CLAUDE_CONFIG_DIR"]?.trim();
  if (!configDir) return join(homedir(), ".claude", "projects");
  const expanded =
    configDir === "~" ? homedir() : configDir.startsWith("~/") ? join(homedir(), configDir.slice(2)) : configDir;
  const expandedRoot = join(expanded, "projects");
  if (!configDir.startsWith("~")) return expandedRoot;

  const literalRoot = join(process.cwd(), configDir, "projects");
  const literalNewest = newestTranscriptMtime(literalRoot);
  if (literalNewest === null) return expandedRoot;

  const expandedNewest = newestTranscriptMtime(expandedRoot);
  if (expandedNewest !== null && expandedNewest >= literalNewest) {
    warnMisplacedRoot(literalRoot, expandedRoot, `the home-dir location (its transcripts are newer)`);
    return expandedRoot;
  }
  warnMisplacedRoot(literalRoot, expandedRoot, `the literal directory (its transcripts are newest)`);
  return literalRoot;
}

function sessionIdFromFilename(filePath: string): string | null {
  const base = filePath.split("/").pop() ?? "";
  return base.endsWith(".jsonl") ? base.slice(0, -".jsonl".length) : null;
}

export async function discoverSessions(root: string = defaultRoot()): Promise<DiscoveredSession[]> {
  const results: DiscoveredSession[] = [];

  let projects: string[];
  try {
    projects = await readdir(root);
  } catch {
    throw new Error(`Cannot read ${root} — is Claude Code installed?`);
  }

  for (const proj of projects) {
    const projPath = join(root, proj);
    const projStat = await stat(projPath).catch(() => null);
    if (!projStat?.isDirectory()) continue;

    const entries = await readdir(projPath).catch(() => [] as string[]);
    for (const entry of entries) {
      const entryPath = join(projPath, entry);
      const entryStat = await stat(entryPath).catch(() => null);

      if (entry.endsWith(".jsonl") && entryStat?.isFile()) {
        results.push({
          filePath: entryPath,
          sessionId: sessionIdFromFilename(entryPath),
          kind: "top-level",
        });
        continue;
      }

      // UUID-named session subdirectory — may contain subagents/
      if (entryStat?.isDirectory() && entry !== "memory") {
        const parentSessionId = entry;
        const sessionSubagentsPath = join(entryPath, "subagents");
        const subStat = await stat(sessionSubagentsPath).catch(() => null);
        if (subStat?.isDirectory()) {
          const subFiles = await readdir(sessionSubagentsPath).catch(() => [] as string[]);
          for (const subFile of subFiles) {
            if (!subFile.endsWith(".jsonl")) continue;
            const subFilePath = join(sessionSubagentsPath, subFile);
            results.push({
              filePath: subFilePath,
              sessionId: sessionIdFromFilename(subFilePath),
              kind: "subagent",
              parentSessionId,
            });
          }
        }
      }
    }
  }

  return results;
}
