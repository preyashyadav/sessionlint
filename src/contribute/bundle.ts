/**
 * Builds the contribution bundle: one JSON object, fully redacted, assembled from
 * discovered transcripts.
 *
 * Two rules drive every decision here.
 *
 * 1. **Default-deny.** Transcript lines go through the same `export --redact`
 *    sanitizer, and the bundle's own metadata is built from an ALLOWLIST of fields
 *    (see BUNDLE_FIELDS) rather than by deleting known-bad keys. A denylist fails
 *    open on the next schema addition; an allowlist fails closed.
 * 2. **Project names never leave.** `~/.claude/projects` directory names are
 *    path-encoded working directories, which routinely carry employer, client, and
 *    unreleased product names. They are replaced with stable per-user pseudonyms and
 *    the mapping stays on the contributor's machine.
 *
 * The residual self-check scans the FINAL SERIALIZED BUNDLE — not the intermediate
 * lines — so anything the assembly step reintroduces is still caught.
 */

import { createSanitizer, SECRET_RE } from "../export/sanitize";

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
/** Absolute POSIX/Windows paths and file:// URLs that survived redaction. */
const PATH_RE = /(^|["\s:])(\/(?:Users|home|var|opt|etc|private)\/|[A-Za-z]:\\\\|file:\/\/)/;
const URL_RE = /https?:\/\/(?!(?:example\.com|localhost))[A-Za-z0-9.-]+/;

/** Exactly what a bundle may contain. Anything not named here is not included. */
export const BUNDLE_FIELDS = [
  "schemaVersion",
  "generator (name + version)",
  "handle (the one you typed)",
  "generatedAt (date only, no clock time)",
  "sessionCount, dateRange",
  "per session: pseudonymous id, project pseudonym, turn count, model names, "
    + "token counts, API-equivalent cost, first/last timestamp",
  "per session: redacted transcript lines (prose, paths, filenames, secrets, and "
    + "free-text keys already replaced with placeholders)",
  "optional: statusline-vs-ledger reconciliation rows, if you ran the experiment",
] as const;

export interface BundleSessionInput {
  /** Real session uuid — replaced with a per-bundle sequential id before it ships. */
  sessionId: string | null;
  /** Real project directory name — replaced with its pseudonym before it ships. */
  projectName: string;
  rawJsonl: string;
  turnCount: number;
  models: string[];
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  firstTimestamp?: string;
  lastTimestamp?: string;
}

export interface BundleOptions {
  handle: string;
  version: string;
  /** real project name -> pseudonym */
  projectMap: Record<string, string>;
  includeProjectNames?: boolean;
  reconciliation?: unknown[];
  generatedAt?: Date;
}

export interface BuiltBundle {
  bundle: Record<string, unknown>;
  json: string;
  /** Counts of what the redactor replaced, by category. */
  redactionCounts: { paths: number; filenames: number; prose: number; keys: number };
  selfCheck: { residualSecrets: number; residualEmails: number; residualPaths: number; residualUrls: number; residualIdentifiers: number; clean: boolean };
  sampleRedactedLine: string | null;
}

/**
 * Second redaction pass, over fields the transcript sanitizer legitimately preserves
 * but a shared corpus must not carry. Every one of these was found by reading a real
 * produced bundle by hand — the automated self-check passed all three, which is the
 * whole argument for the hand audit.
 *
 *   sessionId   Real session UUIDs survive sanitization (they look like identifiers,
 *               because they are). They link a contributor's bundles to each other
 *               and to any transcript shared elsewhere, so they are replaced with the
 *               bundle's own pseudonymous id.
 *   gitBranch   Branch names are free text in practice — `feature/acme-migration`
 *               names a client. Mapped to stable per-bundle pseudonyms.
 *   mcp__X__Y   MCP tool names embed the SERVER name, which routinely identifies a
 *               vendor or internal service. The tool shape is what the rules need, so
 *               the server half is pseudonymized and the tool half is kept.
 */
function scrubResidualIdentifiers(
  line: string,
  sessionIdMap: Map<string, string>,
  branchMap: Map<string, string>,
  mcpMap: Map<string, string>
): string {
  // Replace the ID VALUES, not the keys that carry them. Key-matching missed
  // `session_id` (snake_case) on the first pass while `sessionId` was handled — and
  // there is no reason to believe that is the last spelling Claude Code will use.
  // Substituting the known uuids themselves covers every key, present and future.
  let out = line;
  for (const [real, alias] of sessionIdMap) out = out.split(real).join(alias);
  // Belt and braces: any key whose name ends in session id, whatever its case.
  out = out.replace(/("[a-zA-Z_]*[sS]ession_?[iI]d":\s*")[^"]*(")/g, (m, a: string, c: string) =>
    UUID_RE.test(m) ? `${a}session-redacted${c}` : m
  );

  out = out.replace(/("gitBranch":\s*")([^"]*)(")/g, (_m, a, branch, c) => {
    if (!branch) return a + c; // no branch is not a secret
    let alias = branchMap.get(branch);
    if (!alias) { alias = `branch-${String.fromCharCode(97 + branchMap.size)}`; branchMap.set(branch, alias); }
    return a + alias + c;
  });

  out = out.replace(/mcp__([A-Za-z0-9_.-]+?)__/g, (_m, server) => {
    let alias = mcpMap.get(server);
    if (!alias) { alias = `server-${String.fromCharCode(97 + mcpMap.size)}`; mcpMap.set(server, alias); }
    return `mcp__${alias}__`;
  });

  return out;
}

export function buildBundle(sessions: BundleSessionInput[], options: BundleOptions): BuiltBundle {
  // One sanitizer for the whole bundle → the same real value maps to the same
  // placeholder across sessions, which keeps the corpus analyzable.
  const sanitizer = createSanitizer();
  const generatedAt = options.generatedAt ?? new Date();

  const counts = { paths: 0, filenames: 0, prose: 0, keys: 0 };
  // Shared across sessions so one real branch/server maps to one alias corpus-wide.
  const branchMap = new Map<string, string>();
  const mcpMap = new Map<string, string>();
  // Every real session uuid in this bundle -> its pseudonym, built BEFORE scrubbing so
  // a cross-reference from one session to another is aliased too, not left raw.
  const sessionIdMap = new Map<string, string>();
  sessions.forEach((s2, i2) => {
    if (s2.sessionId) sessionIdMap.set(s2.sessionId, `session-${String(i2 + 1).padStart(3, "0")}`);
  });
  let sampleRedactedLine: string | null = null;

  const outSessions = sessions.map((s, i) => {
    const pseudonym = `session-${String(i + 1).padStart(3, "0")}`;
    const redacted = sanitizer.sanitizeJsonl(s.rawJsonl);
    const lines = redacted
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => scrubResidualIdentifiers(l, sessionIdMap, branchMap, mcpMap));
    for (const l of lines) {
      counts.paths += (l.match(/"\/?dir_\d+_/g) ?? []).length;
      counts.filenames += (l.match(/file_\d+\./g) ?? []).length;
      counts.prose += (l.match(/lorem ipsum/g) ?? []).length;
      counts.keys += (l.match(/"key_\d+"/g) ?? []).length;
    }
    if (!sampleRedactedLine && lines.length > 0) sampleRedactedLine = lines[Math.min(2, lines.length - 1)]!;

    return {
      id: pseudonym,
      project: options.includeProjectNames ? s.projectName : (options.projectMap[s.projectName] ?? "project-unknown"),
      turnCount: s.turnCount,
      models: s.models,
      usage: {
        inputTokens: s.inputTokens,
        outputTokens: s.outputTokens,
        cacheReadTokens: s.cacheReadTokens,
        cacheCreationTokens: s.cacheCreationTokens,
      },
      costUsdApiEquivalent: Number(s.costUsd.toFixed(6)),
      firstTimestamp: s.firstTimestamp ?? null,
      lastTimestamp: s.lastTimestamp ?? null,
      transcript: lines,
    };
  });

  const stamps = sessions.flatMap((s) => [s.firstTimestamp, s.lastTimestamp]).filter(Boolean) as string[];
  stamps.sort();

  const bundle: Record<string, unknown> = {
    schemaVersion: "contrib-1.0.0",
    generator: { name: "sessionlint", version: options.version },
    handle: options.handle,
    // Date only — a clock time is a behavioral fingerprint and buys the study nothing.
    generatedAt: generatedAt.toISOString().slice(0, 10),
    sessionCount: outSessions.length,
    dateRange: stamps.length ? { from: stamps[0]!.slice(0, 10), to: stamps[stamps.length - 1]!.slice(0, 10) } : null,
    projectNamesIncluded: options.includeProjectNames === true,
    sessions: outSessions,
  };
  if (options.reconciliation && options.reconciliation.length > 0) {
    bundle.reconciliation = options.reconciliation;
  }

  const json = JSON.stringify(bundle, null, 2);

  // Self-check runs on the SERIALIZED bundle: whatever assembly reintroduced is caught.
  let residualSecrets = 0, residualEmails = 0, residualPaths = 0, residualUrls = 0, residualIdentifiers = 0;
  for (const line of json.split("\n")) {
    if (SECRET_RE.test(line)) residualSecrets++;
    if (EMAIL_RE.test(line)) residualEmails++;
    if (PATH_RE.test(line)) residualPaths++;
    if (URL_RE.test(line)) residualUrls++;
    // Fail closed on the three classes the hand audit caught: a raw session UUID, an
    // un-aliased branch, or an MCP server name that kept its real identity.
    if (/"[a-zA-Z_]*[sS]ession_?[iI]d":\s*"[0-9a-f]{8}-/.test(line)) residualIdentifiers++;
    if (/"gitBranch":\s*"(?!branch-)[^"]+"/.test(line)) residualIdentifiers++;
    if (/mcp__(?!server-)[A-Za-z0-9_.-]+__/.test(line)) residualIdentifiers++;
  }
  // The handle is a name the contributor chose and typed; it is not a leak.
  const handleLooksLikeEmail = options.handle.includes("@");
  if (handleLooksLikeEmail) residualEmails = Math.max(0, residualEmails - 1);

  return {
    bundle,
    json,
    redactionCounts: counts,
    selfCheck: {
      residualSecrets,
      residualEmails,
      residualPaths,
      residualUrls,
      residualIdentifiers,
      clean:
        residualSecrets === 0 && residualEmails === 0 && residualPaths === 0 &&
        residualUrls === 0 && residualIdentifiers === 0,
    },
    sampleRedactedLine,
  };
}

export function bundleFilename(handle: string, date: Date = new Date()): string {
  const slug = handle.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "anon";
  return `sessionlint-contrib-${slug}-${date.toISOString().slice(0, 10)}.json`;
}

export function subjectLine(handle: string, sessionCount: number, version: string, date: Date = new Date()): string {
  return `[sessionlint] ${handle} · ${date.toISOString().slice(0, 10)} · ${sessionCount} sessions · v${version}`;
}
