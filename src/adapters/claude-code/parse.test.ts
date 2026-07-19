import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { parseSessionFile } from "./parse";

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
});
