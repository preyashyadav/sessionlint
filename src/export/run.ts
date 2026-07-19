/**
 * `sessionlint export --redact`: writes redacted copies of discovered session
 * transcripts to an output directory, so a user can share their history (e.g. to
 * donate to a validation corpus) without leaking prose, paths, filenames, or
 * secrets. Read-only on the source; writes only under outDir.
 *
 * Output files are named session-NNN.jsonl — never a source-derived name — so the
 * project-path-encoded directory names of ~/.claude/projects can't leak either.
 *
 * A post-redaction self-check scans the OUTPUT for any residual secret- or
 * email-shaped text. Redaction is best-effort, not a guarantee: the summary tells
 * the user to review before sharing, and flags residual matches loudly.
 */

import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { discoverSessions, defaultRoot } from "../adapters/claude-code/discover";
import { createSanitizer, SECRET_RE } from "./sanitize";

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

export interface ExportOptions {
  root?: string;
  outDir: string;
}

export interface ExportSummary {
  filesWritten: number;
  outDir: string;
  totalBytes: number;
  /** Output lines where a secret-shaped token still matched after redaction (should be 0). */
  residualSecretLines: number;
  /** Output lines where an email-shaped token still matched after redaction (should be 0). */
  residualEmailLines: number;
}

export async function runExport(options: ExportOptions): Promise<ExportSummary> {
  const root = options.root ?? defaultRoot();
  const discovered = (await discoverSessions(root)).filter((d) => d.kind === "top-level");

  const summary: ExportSummary = {
    filesWritten: 0,
    outDir: options.outDir,
    totalBytes: 0,
    residualSecretLines: 0,
    residualEmailLines: 0,
  };
  if (discovered.length === 0) return summary;

  await mkdir(options.outDir, { recursive: true });
  const sanitizer = createSanitizer(); // one instance → consistent placeholders across the corpus

  let index = 0;
  for (const d of discovered) {
    const raw = await readFile(d.filePath, "utf-8").catch(() => null);
    if (raw === null) continue;

    const redacted = sanitizer.sanitizeJsonl(raw);

    // Post-redaction self-check on the OUTPUT (never assert against the source).
    for (const line of redacted.split("\n")) {
      if (!line.trim()) continue;
      if (SECRET_RE.test(line)) summary.residualSecretLines++;
      if (EMAIL_RE.test(line)) summary.residualEmailLines++;
    }

    index++;
    const outName = `session-${String(index).padStart(3, "0")}.jsonl`;
    await writeFile(join(options.outDir, outName), redacted);
    summary.filesWritten++;
    summary.totalBytes += Buffer.byteLength(redacted, "utf-8");
  }

  return summary;
}

export function renderExportSummary(summary: ExportSummary): string {
  const lines: string[] = [];
  if (summary.filesWritten === 0) {
    return "No sessions found to export. Run Claude Code at least once, or point --dir at your history.";
  }
  const kb = (summary.totalBytes / 1024).toFixed(0);
  lines.push(`sessionlint export · ${summary.filesWritten} redacted transcript(s) → ${summary.outDir}/ (${kb} KB)`);
  lines.push("");
  lines.push("  Redacted: prose, file contents, paths, filenames, secrets, and free-text keys.");
  lines.push("  Preserved: model names, tool names, timestamps, entry types, and usage token counts");
  lines.push("  (so the redacted transcripts are still analyzable).");
  lines.push("");
  if (summary.residualSecretLines > 0 || summary.residualEmailLines > 0) {
    lines.push(
      `  ⚠ SELF-CHECK FOUND RESIDUALS — do NOT share until you inspect these: ` +
        `${summary.residualSecretLines} line(s) still match a secret pattern, ` +
        `${summary.residualEmailLines} an email pattern. Please open an issue with the shape (not the value).`
    );
  } else {
    lines.push("  Self-check: no secret- or email-shaped text remained in the output.");
  }
  lines.push("");
  lines.push("  ⚠ Redaction is best-effort, not a guarantee. REVIEW the output before sharing it.");
  return lines.join("\n");
}
