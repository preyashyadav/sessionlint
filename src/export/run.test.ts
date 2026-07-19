import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile, readdir, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { runExport } from "./run";

let root: string;
let outDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sessionlint-export-src-"));
  outDir = await mkdtemp(join(tmpdir(), "sessionlint-export-out-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
});

// A source project dir whose NAME encodes a real absolute path (as ~/.claude/projects does),
// containing a transcript with fake secrets, paths, prose, and an email.
async function seed(): Promise<void> {
  const projDir = join(root, "-Users-janedoe-Documents-acme-secret-project");
  await mkdir(projDir, { recursive: true });
  const jsonl = [
    JSON.stringify({
      type: "assistant",
      sessionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      timestamp: "2026-01-01T00:00:00.000Z",
      cwd: "/Users/janedoe/Documents/acme-secret-project",
      message: {
        model: "claude-opus-4-8",
        content: [{ type: "text", text: "key sk-ant-fakeSecret1234567890abcdef and email jane@acme-corp.example" }],
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    }),
    JSON.stringify({ type: "user", message: { role: "user", content: "Fix billing.ts in acme-secret-project" } }),
  ].join("\n");
  await writeFile(join(projDir, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl"), jsonl + "\n");
}

describe("runExport --redact", () => {
  test("writes redacted, flattened session-NNN files with no source PII and clean self-check", async () => {
    await seed();
    const summary = await runExport({ root, outDir });

    expect(summary.filesWritten).toBe(1);
    expect(summary.residualSecretLines).toBe(0);
    expect(summary.residualEmailLines).toBe(0);

    const outFiles = await readdir(outDir);
    expect(outFiles).toEqual(["session-001.jsonl"]); // flattened, source-independent name

    const content = await readFile(join(outDir, "session-001.jsonl"), "utf-8");
    // No fake secret, path, project name, filename, or email survives.
    for (const leak of ["janedoe", "acme-secret-project", "acme-corp", "billing.ts", "sk-ant-fakeSecret1234567890abcdef", "jane@acme-corp.example"]) {
      expect(content).not.toContain(leak);
    }
    // Preserved signals the rules/cost engine need:
    const first = JSON.parse(content.split("\n")[0]!);
    expect(first.message.model).toBe("claude-opus-4-8");
    expect(first.timestamp).toBe("2026-01-01T00:00:00.000Z");
    expect(first.message.usage.input_tokens).toBe(10);
  });

  test("empty source: writes nothing, reports zero", async () => {
    const summary = await runExport({ root, outDir });
    expect(summary.filesWritten).toBe(0);
    expect(await readdir(outDir)).toEqual([]);
  });

  test("output filename never derives from the source project-path directory", async () => {
    await seed();
    await runExport({ root, outDir });
    const outFiles = await readdir(outDir);
    // No output name contains the source project encoding or the session UUID.
    for (const f of outFiles) {
      expect(f).not.toContain("janedoe");
      expect(f).not.toContain("aaaaaaaa");
    }
  });
});
