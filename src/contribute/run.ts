/**
 * `sessionlint send2preyash` (alias `contribute`): prepares a redacted bundle and
 * hands the user a prefilled draft in their own mail client.
 *
 * The whole design constraint is that sessionlint never transmits anything. There is
 * no SMTP, no upload, no API call — the command writes a file the user can inspect
 * and opens a draft they attach it to and send themselves. Two confirmations gate the
 * flow (once before reading, once after the preview), and the second one shows a real
 * redacted line from their own data so they can see the shape of what leaves.
 *
 * Refuses under --paranoid, same as every other outward-facing surface.
 */

import { readFile, writeFile } from "fs/promises";
import { createInterface } from "readline/promises";
import { basename, join, resolve } from "path";
import { homedir } from "os";
import { discoverSessionsAcross, resolveRoots, type DiscoveredSession } from "../adapters/claude-code/discover";
import { loadSession } from "../adapters/claude-code/session";
import { computeSessionCost } from "../cost/compute";
import { buildBundle, bundleFilename, subjectLine, BUNDLE_FIELDS, type BundleSessionInput } from "./bundle";
import { buildBody, openDraft } from "./mail";
import { resolveRecipient } from "./recipient";
import { assignPseudonyms, readState, validateHandle, writeState } from "./state";

export interface ContributeOptions {
  args: string[];
  version: string;
  paranoid: boolean;
  cwd?: string;
}

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

/** Explicit y. Never a default-yes prompt, and never auto-yes in a pipe. */
async function confirm(question: string, autoYes: boolean): Promise<boolean> {
  if (autoYes) {
    console.log(`${question} --yes`);
    return true;
  }
  if (!process.stdin.isTTY) {
    console.error("Non-interactive terminal — pass --yes only if you have already reviewed what this sends.");
    return false;
  }
  return /^y(es)?$/i.test(await ask(`${question} (y/N) `));
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
}

/** projects/<encoded-project>/<uuid>.jsonl → the encoded project dir name. */
function projectNameOf(filePath: string): string {
  const parts = filePath.split("/");
  const i = parts.lastIndexOf("projects");
  return i !== -1 && parts[i + 1] ? parts[i + 1]! : "unknown";
}

export async function runContribute(options: ContributeOptions): Promise<number> {
  const { args, version } = options;
  const cwd = options.cwd ?? process.cwd();
  const autoYes = args.includes("--yes");

  if (options.paranoid) {
    console.error("sessionlint send2preyash refused: --paranoid blocks anything that leaves this machine.");
    return 1;
  }

  const recipient = resolveRecipient(args);
  const includeProjectNames = args.includes("--include-project-names");

  // ---- 1. explain, then confirm ----
  console.log(
    [
      ``,
      `sessionlint — contribute a redacted copy of your session history`,
      ``,
      `  What this does   Bundles your Claude Code transcripts into ONE redacted file`,
      `                   and opens a draft email. It does NOT send anything. You`,
      `                   attach the file and press send yourself.`,
      `  Who receives it  ${recipient}`,
      `  Used for         Measuring how accurate sessionlint's cost ledger and lint`,
      `                   rules are across real, varied users — today every number in`,
      `                   the project comes from one machine.`,
      `  Stripped         Prose, file contents, paths, filenames, secrets, free-text`,
      `                   keys, and project directory names${includeProjectNames ? " (DISABLED by --include-project-names)" : ""}.`,
      `  Kept             Model names, timestamps, token counts, tool names, turn`,
      `                   structure — what the rules and cost math need.`,
      ``,
      `  You will see a full preview, including a real redacted line from your own`,
      `  data, before any file is written.`,
      ``,
    ].join("\n")
  );
  if (includeProjectNames) {
    console.log(
      `  ⚠ --include-project-names is ON. Project directory names are path-encoded\n` +
      `    working directories and routinely contain employer, client, and unreleased\n` +
      `    product names. They will be included VERBATIM.\n`
    );
  }
  if (!(await confirm("Continue?", autoYes))) {
    console.log("Cancelled — nothing was read, written, or sent.");
    return 0;
  }

  // ---- 2. select sessions ----
  const roots = resolveRoots(args.includes("--add-root") ? args : [...args, "--all-roots"]);
  let discovered = (await discoverSessionsAcross(roots)).filter((d: DiscoveredSession) => d.kind === "top-level");

  const only = flag(args, "--session");
  if (only) discovered = discovered.filter((d) => d.sessionId?.startsWith(only));

  const loadedAll = [];
  for (const d of discovered) {
    const loaded = await loadSession(d.filePath, d.sessionId);
    loadedAll.push({ d, loaded, cost: computeSessionCost(loaded.session) });
  }

  let rows = loadedAll.map((x) => {
    const turns = x.loaded.session.turns;
    const stamps = turns.map((t) => t.startedAt).filter(Boolean) as Date[];
    stamps.sort((a, b) => a.getTime() - b.getTime());
    return { ...x, first: stamps[0] ?? null, last: stamps[stamps.length - 1] ?? null, turnCount: turns.length };
  });

  const since = flag(args, "--since");
  if (since) {
    const cutoff = new Date(since);
    if (Number.isNaN(cutoff.getTime())) {
      console.error(`--since: "${since}" is not a date I can read. Use YYYY-MM-DD.`);
      return 2;
    }
    rows = rows.filter((r) => r.last !== null && r.last >= cutoff);
  }

  rows.sort((a, b) => (b.last?.getTime() ?? 0) - (a.last?.getTime() ?? 0));
  const lastN = flag(args, "--last");
  if (lastN) rows = rows.slice(0, Math.max(0, Number(lastN) || 0));

  if (rows.length === 0) {
    console.log("No sessions matched — nothing to contribute. (Try without --last/--since/--session.)");
    return 0;
  }

  // ---- pseudonyms, assigned locally and stored locally ----
  const state = await readState();
  const projectMap = assignPseudonyms(state.projectMap ?? {}, rows.map((r) => projectNameOf(r.d.filePath)));

  // ---- handle ----
  let handle = flag(args, "--handle") ?? state.handle;
  if (!handle) {
    if (!process.stdin.isTTY) {
      console.error("No handle set. Pass --handle <name> (it is never derived from your username or git config).");
      return 2;
    }
    for (;;) {
      const raw = await ask("Pick a handle to identify your contribution (not an email): ");
      const v = validateHandle(raw);
      if (v.ok) { handle = v.handle; break; }
      console.log(`  ${v.reason}`);
    }
  } else {
    const v = validateHandle(handle);
    if (!v.ok) { console.error(`--handle: ${v.reason}`); return 2; }
    handle = v.handle;
  }

  console.log(`\n  ${rows.length} session(s) selected:\n`);
  console.log(`    ${"session".padEnd(10)} ${"last active".padEnd(12)} ${"project".padEnd(12)} ${"turns".padStart(5)}`);
  for (const r of rows) {
    const label = includeProjectNames ? projectNameOf(r.d.filePath) : projectMap[projectNameOf(r.d.filePath)]!;
    console.log(
      `    ${(r.d.sessionId ?? "?").slice(0, 8).padEnd(10)} ` +
      `${(r.last ? r.last.toISOString().slice(0, 10) : "—").padEnd(12)} ${label.slice(0, 12).padEnd(12)} ${String(r.turnCount).padStart(5)}`
    );
  }

  // ---- 3. redact ----
  const inputs: BundleSessionInput[] = [];
  for (const r of rows) {
    const raw = await readFile(r.d.filePath, "utf8").catch(() => null);
    if (raw === null) continue;
    const models = [...new Set(r.loaded.session.turns.map((t) => t.model).filter(Boolean))] as string[];
    const u = r.loaded.session.turns.reduce(
      (acc, t) => ({
        i: acc.i + (t.usage?.inputTokens ?? 0),
        o: acc.o + (t.usage?.outputTokens ?? 0),
        cr: acc.cr + (t.usage?.cacheReadInputTokens ?? 0),
        cc: acc.cc + (t.usage?.cacheCreationInputTokens ?? 0),
      }),
      { i: 0, o: 0, cr: 0, cc: 0 }
    );
    inputs.push({
      sessionId: r.d.sessionId,
      projectName: projectNameOf(r.d.filePath),
      rawJsonl: raw,
      turnCount: r.turnCount,
      models,
      inputTokens: u.i, outputTokens: u.o, cacheReadTokens: u.cr, cacheCreationTokens: u.cc,
      costUsd: r.cost.totalCost,
      firstTimestamp: r.first?.toISOString(),
      lastTimestamp: r.last?.toISOString(),
    });
  }

  // ---- optional reconciliation rows ----
  let reconciliation: unknown[] | undefined;
  if (args.includes("--include-reconciliation")) {
    const logPath = join(homedir(), ".sessionlint", "experiment", "statusline-samples.jsonl");
    const raw = await readFile(logPath, "utf8").catch(() => null);
    if (raw === null) {
      console.log(`\n  (--include-reconciliation: no capture log at ${logPath} — skipping.)`);
    } else {
      const samples = raw.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      // Only the accounting fields, keyed to the bundle's pseudonymous session ids.
      const idx = new Map(rows.map((r, i) => [r.d.sessionId, `session-${String(i + 1).padStart(3, "0")}`]));
      reconciliation = samples
        .filter((s: any) => idx.has(s.sessionId))
        .map((s: any) => ({
          id: idx.get(s.sessionId),
          capturedAt: typeof s.capturedAt === "string" ? s.capturedAt.slice(0, 10) : null,
          costTotalUsd: s.costTotalUsd ?? null,
          ctxTotalInput: s.ctxTotalInput ?? null,
          ctxTotalOutput: s.ctxTotalOutput ?? null,
          thinkingEnabled: s.thinkingEnabled ?? null,
          fastMode: s.fastMode ?? null,
          ccVersion: s.version ?? null,
        }));
      console.log(`\n  reconciliation: ${reconciliation.length} statusline sample(s) matched to selected sessions.`);
    }
  }

  const built = buildBundle(inputs, { handle, version, projectMap, includeProjectNames, reconciliation });

  // ---- 4. preview, then confirm again ----
  const totals = inputs.reduce((a, s) => ({ tok: a.tok + s.inputTokens + s.outputTokens, cost: a.cost + s.costUsd }), { tok: 0, cost: 0 });
  const range = built.bundle.dateRange as { from: string; to: string } | null;
  const fileName = bundleFilename(handle);
  const filePath = resolve(cwd, fileName);

  console.log(
    [
      ``,
      `  ── preview ─────────────────────────────────────────────────────────`,
      `  sessions        ${inputs.length}`,
      `  date range      ${range ? `${range.from} to ${range.to}` : "n/a"}`,
      `  tokens          ${totals.tok.toLocaleString()} (input + output)`,
      `  cost            $${totals.cost.toFixed(2)} API-equivalent`,
      `  bundle size     ${(Buffer.byteLength(built.json) / 1024).toFixed(0)} kB`,
      `  writes to       ${filePath}`,
      ``,
      `  redactor replaced: ${built.redactionCounts.paths} path(s), ${built.redactionCounts.filenames} filename(s), ` +
        `${built.redactionCounts.prose} prose block(s), ${built.redactionCounts.keys} free-text key(s)`,
      ``,
      `  fields included:`,
      ...BUNDLE_FIELDS.map((f) => `    · ${f}`),
      ``,
      `  one real redacted line from your data:`,
      `    ${(built.sampleRedactedLine ?? "(none)").slice(0, 220)}${(built.sampleRedactedLine?.length ?? 0) > 220 ? "…" : ""}`,
      ``,
      `  self-check      ${built.selfCheck.clean ? "clean — no residual secret, email, path, URL, or identifier pattern" : "FAILED"}`,
      `  ────────────────────────────────────────────────────────────────────`,
      ``,
    ].join("\n")
  );

  if (!built.selfCheck.clean) {
    console.error(
      `Refusing to write the bundle — the redaction self-check tripped:\n` +
        `  residual secrets ${built.selfCheck.residualSecrets}, emails ${built.selfCheck.residualEmails}, ` +
        `paths ${built.selfCheck.residualPaths}, urls ${built.selfCheck.residualUrls}, ` +
        `identifiers ${built.selfCheck.residualIdentifiers}\n` +
        `This is a redactor bug. Please open an issue — do not share anything by hand in the meantime.`
    );
    return 3;
  }

  if (!(await confirm("Write this bundle and open a mail draft?", autoYes))) {
    console.log("Cancelled — no file was written.");
    return 0;
  }

  // ---- 5. write one file, where the user can find it ----
  await writeFile(filePath, built.json, "utf8");
  await writeState({ ...state, handle, projectMap });

  // ---- 6. open a prefilled draft ----
  const subject = subjectLine(handle, inputs.length, version);
  const body = buildBody({ handle, version, sessionCount: inputs.length, dateRange: range, filePath });
  const opened = await openDraft({ to: recipient, subject, body }, filePath);

  // ---- 7. manual fallback, always ----
  console.log(
    [
      ``,
      `  ✓ wrote ${basename(filePath)}`,
      ``,
      opened.mailClientOpened ? `  A draft should have opened in your mail client.` : `  Could not open a mail client automatically.`,
      opened.copiedToClipboard ? `  The file path is on your clipboard.` : ``,
      opened.revealedInFinder ? `  The file is revealed in Finder — drag it into the draft.` : ``,
      ``,
      `  ── send it manually if you prefer ──────────────────────────────────`,
      `  to        ${recipient}`,
      `  subject   ${subject}`,
      `  attach    ${filePath}`,
      `  ────────────────────────────────────────────────────────────────────`,
      ``,
      `  Nothing has been sent. sessionlint cannot send it — you do.`,
      `  Changed your mind? Delete the file; nothing else was written except your`,
      `  handle and project pseudonyms in ~/.sessionlint/contrib-state.json.`,
      ``,
    ].filter((l) => l !== "").join("\n")
  );
  return 0;
}
