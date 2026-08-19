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

/**
 * A Claude Code config directory found on this machine, and whether this run reads it.
 *
 * sessionlint historically read exactly one projects root — whatever CLAUDE_CONFIG_DIR
 * pointed at, or ~/.claude — and said nothing about the rest. On a machine running two
 * accounts that meant reporting on 7 of 22 sessions with no warning at all, which is
 * the worst failure mode this tool can have: a confident total that is quietly missing
 * two thirds of the data. Detection is deliberately conservative (a sibling root is
 * REPORTED, never silently merged) because sessions from different accounts should not
 * be pooled into one cost figure without the user asking for it.
 */
export interface ConfigRoot {
  /** The config dir itself, e.g. /Users/x/.claude-account-b */
  configDir: string;
  /** Its projects/ subdirectory — what discoverSessions() takes. */
  projectsRoot: string;
  /** Short display label, e.g. ".claude-account-b" */
  label: string;
  /** Top-level transcripts directly under projects/<proj>/. */
  transcriptCount: number;
  newestMtime: number | null;
  /** True when this run actually reads it. */
  scanned: boolean;
}

/** Top-level transcript count under a projects root (shallow, sync — a probe, not a scan). */
function countTranscripts(root: string): number {
  let n = 0;
  let projDirs: string[];
  try {
    projDirs = readdirSync(root);
  } catch {
    return 0;
  }
  for (const proj of projDirs) {
    try {
      for (const entry of readdirSync(join(root, proj))) if (entry.endsWith(".jsonl")) n++;
    } catch {
      /* not a directory, or unreadable — skip */
    }
  }
  return n;
}

/**
 * Every plausible Claude Code config root on this machine: `~/.claude` plus any
 * `~/.claude-*` sibling, plus whatever CLAUDE_CONFIG_DIR resolved to (which may be
 * neither). Only roots that actually hold at least one transcript are returned —
 * an empty `~/.claude` left behind by an uninstall is noise, not a finding.
 *
 * `scannedRoots` marks which projects roots this run is actually reading, so callers
 * can render "scanned" vs "found but NOT scanned" without re-deriving it.
 */
export function discoverConfigRoots(scannedRoots: string[] = [defaultRoot()]): ConfigRoot[] {
  const home = homedir();
  const candidates = new Map<string, string>(); // projectsRoot -> configDir

  let homeEntries: string[] = [];
  try {
    homeEntries = readdirSync(home);
  } catch {
    /* unreadable home — fall through to the explicit roots below */
  }
  for (const entry of homeEntries) {
    if (entry !== ".claude" && !entry.startsWith(".claude-")) continue;
    const configDir = join(home, entry);
    candidates.set(join(configDir, "projects"), configDir);
  }

  // Whatever is actually being read must appear even if it lives outside the home dir
  // (an absolute CLAUDE_CONFIG_DIR, or the literal-"~" misplacement case).
  for (const r of scannedRoots) candidates.set(r, r.replace(/\/projects$/, ""));

  const scanned = new Set(scannedRoots);
  const roots: ConfigRoot[] = [];
  for (const [projectsRoot, configDir] of candidates) {
    const transcriptCount = countTranscripts(projectsRoot);
    if (transcriptCount === 0 && !scanned.has(projectsRoot)) continue;
    roots.push({
      configDir,
      projectsRoot,
      label: configDir.startsWith(home + "/") ? configDir.slice(home.length + 1) : configDir,
      transcriptCount,
      newestMtime: newestTranscriptMtime(projectsRoot),
      scanned: scanned.has(projectsRoot),
    });
  }
  // Scanned first, then by transcript count — the unscanned rows are the warning.
  return roots.sort((a, b) => Number(b.scanned) - Number(a.scanned) || b.transcriptCount - a.transcriptCount);
}

/** Roots holding transcripts that this run is NOT reading. Empty is the normal case. */
export function unscannedRoots(roots: ConfigRoot[]): ConfigRoot[] {
  return roots.filter((r) => !r.scanned && r.transcriptCount > 0);
}

/** discoverSessions across several roots, de-duplicated by absolute file path. */
export async function discoverSessionsAcross(roots: string[]): Promise<DiscoveredSession[]> {
  const seen = new Set<string>();
  const all: DiscoveredSession[] = [];
  let firstError: unknown = null;
  let anyReadable = false;

  for (const root of roots) {
    let found: DiscoveredSession[];
    try {
      found = await discoverSessions(root);
      anyReadable = true;
    } catch (err) {
      // One bad EXTRA root must not lose the others — but a run where nothing at all
      // was readable is a real error (a typo'd --dir, most often) and has to surface,
      // not quietly report zero sessions.
      firstError ??= err;
      continue;
    }
    for (const d of found) {
      if (seen.has(d.filePath)) continue;
      seen.add(d.filePath);
      all.push(d);
    }
  }

  if (!anyReadable && firstError !== null) throw firstError;
  return all;
}

/**
 * Resolves the roots a command should read from CLI flags.
 *   (none)            → just the default root
 *   --all-roots       → every detected root holding transcripts
 *   --add-root <path> → the default root plus this one (repeatable; accepts either a
 *                       config dir or a projects dir, since both are things a user
 *                       plausibly types)
 */
export function resolveRoots(args: string[], base: string = defaultRoot()): string[] {
  const roots = [base];
  if (args.includes("--all-roots")) {
    for (const r of discoverConfigRoots([base])) {
      if (r.transcriptCount > 0 && !roots.includes(r.projectsRoot)) roots.push(r.projectsRoot);
    }
  }
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "--add-root") continue;
    const raw = args[i + 1];
    if (!raw) continue;
    const asProjects = raw.endsWith("/projects") || raw.endsWith("/projects/") ? raw.replace(/\/$/, "") : join(raw, "projects");
    const chosen = countTranscripts(asProjects) > 0 ? asProjects : raw;
    if (!roots.includes(chosen)) roots.push(chosen);
  }
  return roots;
}
