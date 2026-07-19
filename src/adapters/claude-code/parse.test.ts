import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { parseSessionFile, MAX_LINE_CHARS } from "./parse";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "sessionlint-parse-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("parseSessionFile", () => {
  test("parses valid JSONL lines, preserving line numbers", async () => {
    const filePath = join(dir, "session.jsonl");
    await writeFile(
      filePath,
      [JSON.stringify({ type: "user" }), JSON.stringify({ type: "assistant" })].join("\n") + "\n"
    );

    const result = await parseSessionFile(filePath);
    expect(result.parseErrorCount).toBe(0);
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toMatchObject({ lineNumber: 1, raw: { type: "user" } });
    expect(result.lines[1]).toMatchObject({ lineNumber: 2, raw: { type: "assistant" } });
  });

  test("skips blank lines without counting them as errors", async () => {
    const filePath = join(dir, "session.jsonl");
    await writeFile(filePath, `${JSON.stringify({ type: "user" })}\n\n\n`);

    const result = await parseSessionFile(filePath);
    expect(result.lines).toHaveLength(1);
    expect(result.parseErrorCount).toBe(0);
  });

  test("skips malformed JSON lines, counts them, and keeps parsing subsequent lines", async () => {
    const filePath = join(dir, "session.jsonl");
    await writeFile(
      filePath,
      [
        JSON.stringify({ type: "user" }),
        "{not valid json",
        JSON.stringify({ type: "assistant" }),
      ].join("\n") + "\n"
    );

    const result = await parseSessionFile(filePath);
    expect(result.parseErrorCount).toBe(1);
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]?.lineNumber).toBe(1);
    expect(result.lines[1]?.lineNumber).toBe(3);
  });

  test("empty file: no lines, no errors, no crash", async () => {
    const filePath = join(dir, "empty.jsonl");
    await writeFile(filePath, "");

    const result = await parseSessionFile(filePath);
    expect(result.lines).toEqual([]);
    expect(result.parseErrorCount).toBe(0);
  });

  test("oversized line is skipped and counted, not parsed; surrounding lines survive", async () => {
    const filePath = join(dir, "oversized.jsonl");
    const huge = '{"type":"user","x":"' + "a".repeat(MAX_LINE_CHARS + 5) + '"}';
    await writeFile(
      filePath,
      [JSON.stringify({ type: "user" }), huge, JSON.stringify({ type: "assistant" })].join("\n") + "\n"
    );
    const result = await parseSessionFile(filePath);
    expect(result.oversizedLineCount).toBe(1);
    expect(result.lines).toHaveLength(2); // the two normal lines still parse
    expect(result.parseErrorCount).toBe(0);
  });

  test("fuzz: hostile/malformed lines never throw and never lose a valid entry", async () => {
    const ESC = String.fromCharCode(27); // ANSI escape byte
    const NONCHARS = String.fromCharCode(0xffff, 0xfffe); // Unicode non-characters
    const NUL = String.fromCharCode(0); // embedded NUL
    const hostile = [
      "{", // truncated
      "]}{[", // garbage
      '{"type":"user"', // unterminated
      ` ${ESC}[31mNOT JSON${ESC}[0m`, // control chars + ANSI
      `{"type":"user"${NUL}}`, // embedded NUL inside otherwise-JSON
      NONCHARS, // Unicode non-characters
      '{"a":' + "[".repeat(5000) + "1" + "]".repeat(5000) + "}", // deeply nested
      "null",
      "true",
      "42",
      '"a string"', // valid JSON, non-object entries
      JSON.stringify({ type: "user", ok: true }), // one genuinely valid object
    ].join("\n");
    const filePath = join(dir, "fuzz.jsonl");
    await writeFile(filePath, hostile);

    const result = await parseSessionFile(filePath); // must not throw for any input
    expect(result.oversizedLineCount).toBe(0);
    expect(result.lines.length).toBeGreaterThanOrEqual(1); // the valid object survives
    expect(result.parseErrorCount).toBeGreaterThan(0); // bad lines counted, not fatal
  });
});
