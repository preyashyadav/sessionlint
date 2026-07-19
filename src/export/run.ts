/**
 * `sessionlint export --redact`: writes redacted copies of discovered session
 * transcripts to an output directory, so a user can share their history (e.g. to
 * donate to a validation corpus) without leaking prose, paths, filenames, or
 * secrets. Read-only on the source; writes only under outDir.
 *
 * Output files are named session-NNN.jsonl — never a source-derived name — so the
 * project-path-encoded directory names of ~/.claude/projects can't leak either.
 * Every export also writes a MANIFEST.md receipt: exactly what's included, what was
 * redacted vs preserved, a self-check result, a sample redacted line, and consent /
 * how-to-share guidance.
 *
 * `--dry-run` computes the same summary and sample WITHOUT writing anything, so a
 * user can see precisely what they'd be sharing before committing.
 *
 * A post-redaction self-check scans the OUTPUT for any residual secret- or
 * email-shaped text. Redaction is best-effort, not a guarantee.
 */

import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { discoverSessions, defaultRoot } from "../adapters/claude-code/discover";
import { createSanitizer, SECRET_RE } from "./sanitize";

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

export interface ExportOptions {
  root?: string;
  outDir: string;
  dryRun?: boolean;
  /** sessionlint version, recorded in the manifest. */
  version?: string;
}

export interface ExportSummary {
  dryRun: boolean;
  outDir: string;
  /** Sessions that were (or, in dry-run, would be) exported. */
  filesFound: number;
  /** Sessions actually written (0 in dry-run). */
  filesWritten: number;
  totalBytes: number;
  /** Output lines where a secret-shaped token still matched after redaction (should be 0). */
  residualSecretLines: number;
  /** Output lines where an email-shaped token still matched after redaction (should be 0). */
  residualEmailLines: number;
  /** One redacted line, so the user can see the shape they'd be sharing. */
  sampleRedactedLine?: string;
  earliestTimestamp?: string;
  latestTimestamp?: string;
}

const PRESERVED_FIELDS = "model names, tool names, timestamps, entry/block types, usage token counts";
const REDACTED_FIELDS = "prose, file contents, absolute/relative paths, filenames, secrets, and free-text object keys";

export async function runExport(options: ExportOptions): Promise<ExportSummary> {
  const root = options.root ?? defaultRoot();
  const dryRun = options.dryRun ?? false;
  const discovered = (await discoverSessions(root)).filter((d) => d.kind === "top-level");

  const summary: ExportSummary = {
    dryRun,
    outDir: options.outDir,
    filesFound: 0,
    filesWritten: 0,
    totalBytes: 0,
    residualSecretLines: 0,
    residualEmailLines: 0,
  };
  if (discovered.length === 0) return summary;

  if (!dryRun) await mkdir(options.outDir, { recursive: true });
  const sanitizer = createSanitizer(); // one instance → consistent placeholders across the corpus

  let index = 0;
  for (const d of discovered) {
    const raw = await readFile(d.filePath, "utf-8").catch(() => null);
    if (raw === null) continue;

    const redacted = sanitizer.sanitizeJsonl(raw);
    index++;
    summary.filesFound++;
    summary.totalBytes += Buffer.byteLength(redacted, "utf-8");

    for (const line of redacted.split("\n")) {
      if (!line.trim()) continue;
      if (SECRET_RE.test(line)) summary.residualSecretLines++;
      if (EMAIL_RE.test(line)) summary.residualEmailLines++;
      if (!summary.sampleRedactedLine) summary.sampleRedactedLine = line;
      try {
        const ts = (JSON.parse(line) as { timestamp?: unknown }).timestamp;
        if (typeof ts === "string") {
          if (!summary.earliestTimestamp || ts < summary.earliestTimestamp) summary.earliestTimestamp = ts;
          if (!summary.latestTimestamp || ts > summary.latestTimestamp) summary.latestTimestamp = ts;
        }
      } catch {
        /* a redacted line that doesn't reparse is impossible (we just produced it), but stay safe */
      }
    }

    if (!dryRun) {
      const outName = `session-${String(index).padStart(3, "0")}.jsonl`;
      await writeFile(join(options.outDir, outName), redacted);
      summary.filesWritten++;
    }
  }

  if (!dryRun && summary.filesFound > 0) {
    await writeFile(join(options.outDir, "MANIFEST.md"), renderManifest(summary, options.version ?? "unknown"));
  }
  return summary;
}

/** The receipt written into the export folder — what's included, redaction summary,
 * self-check, a sample line, and consent / how-to-share guidance. */
export function renderManifest(summary: ExportSummary, version: string): string {
  const kb = (summary.totalBytes / 1024).toFixed(0);
  const span =
    summary.earliestTimestamp && summary.latestTimestamp
      ? `${summary.earliestTimestamp.slice(0, 10)} to ${summary.latestTimestamp.slice(0, 10)}`
      : "unknown";
  const selfCheck =
    summary.residualSecretLines > 0 || summary.residualEmailLines > 0
      ? `⚠ ${summary.residualSecretLines} line(s) still match a secret pattern and ${summary.residualEmailLines} an email pattern — DO NOT share until reviewed.`
      : "No secret- or email-shaped text remained in the output.";

  return [
    "# sessionlint export — redacted transcripts",
    "",
    `Generated by sessionlint ${version}. This folder contains **redacted** Claude Code`,
    "session transcripts. It is safe to share **after you review it** — see below.",
    "",
    "## What's in this folder",
    "",
    `- **${summary.filesWritten} transcript(s)** (\`session-NNN.jsonl\`), ~${kb} KB total`,
    `- Date range: ${span}`,
    "- No `MANIFEST.md` content is sent anywhere automatically — you share this folder yourself.",
    "",
    "## What was redacted vs preserved",
    "",
    `- **Redacted (removed):** ${REDACTED_FIELDS}.`,
    `- **Preserved (kept, so the data is still analyzable):** ${PRESERVED_FIELDS}.`,
    "- Filenames are flattened to `session-NNN.jsonl` so your project paths can't leak via names.",
    "",
    "## Automated self-check",
    "",
    `- ${selfCheck}`,
    "",
    "## Sample redacted line (this is the shape you'd be sharing)",
    "",
    "```json",
    summary.sampleRedactedLine ?? "(none)",
    "```",
    "",
    "## Consent & how to share",
    "",
    "By sending this folder you consent to its use for improving sessionlint's detection",
    "rules. Redaction is **best-effort, not a guarantee** — please open a couple of the",
    "`session-NNN.jsonl` files and confirm you're comfortable with the contents first.",
    "",
    "Share it **privately** (email or a private file link) with whoever requested it —",
    "do **not** post it in a public issue or forum. You can request deletion at any time.",
    "",
  ].join("\n");
}

export function renderExportSummary(summary: ExportSummary): string {
  if (summary.filesFound === 0) {
    return "No sessions found to export. Run Claude Code at least once, or point --dir at your history.";
  }
  const kb = (summary.totalBytes / 1024).toFixed(0);
  const lines: string[] = [];

  if (summary.dryRun) {
    lines.push(`sessionlint export · DRY RUN — nothing written. ${summary.filesFound} transcript(s) would be redacted (~${kb} KB).`);
  } else {
    lines.push(`sessionlint export · ${summary.filesWritten} redacted transcript(s) → ${summary.outDir}/ (~${kb} KB)`);
    lines.push(`  Receipt: ${summary.outDir}/MANIFEST.md (what's included, redaction summary, consent).`);
  }
  lines.push("");
  lines.push(`  Redacted: ${REDACTED_FIELDS}.`);
  lines.push(`  Preserved: ${PRESERVED_FIELDS}.`);
  lines.push("");
  if (summary.sampleRedactedLine) {
    const sample = summary.sampleRedactedLine.length > 200 ? summary.sampleRedactedLine.slice(0, 200) + "…" : summary.sampleRedactedLine;
    lines.push("  Sample redacted line (the shape you'd share):");
    lines.push(`    ${sample}`);
    lines.push("");
  }
  if (summary.residualSecretLines > 0 || summary.residualEmailLines > 0) {
    lines.push(
      `  ⚠ SELF-CHECK FOUND RESIDUALS — do NOT share until you inspect these: ` +
        `${summary.residualSecretLines} line(s) still match a secret pattern, ` +
        `${summary.residualEmailLines} an email pattern.`
    );
  } else {
    lines.push("  Self-check: no secret- or email-shaped text remained in the output.");
  }
  lines.push("");
  if (summary.dryRun) {
    lines.push("  Dry run only — re-run without --dry-run to write the files + MANIFEST.md.");
  } else {
    lines.push("  ⚠ Redaction is best-effort, not a guarantee. REVIEW the output before sharing it.");
  }
  return lines.join("\n");
}
