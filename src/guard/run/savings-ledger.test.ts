import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { appendLedgerEntry } from "./savings-ledger";
import type { RunResult } from "./types";

const sampleResult: RunResult = {
  succeeded: true,
  totalCostUsd: 0.02,
  rungs: [{ model: "haiku", costUsd: 0.02, isError: false, successCheckExitCode: 0, succeeded: true, durationMs: 100 }],
};

describe("appendLedgerEntry", () => {
  test("appends one JSON line per call, creating the directory if needed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sessionlint-ledger-"));
    try {
      const ledgerPath = join(dir, "nested", "ledger.jsonl");
      await appendLedgerEntry(ledgerPath, { timestamp: "2026-07-13T00:00:00.000Z", result: sampleResult });
      await appendLedgerEntry(ledgerPath, { timestamp: "2026-07-13T01:00:00.000Z", result: sampleResult });
      const lines = (await readFile(ledgerPath, "utf8")).trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]!).timestamp).toBe("2026-07-13T00:00:00.000Z");
      expect(JSON.parse(lines[1]!).timestamp).toBe("2026-07-13T01:00:00.000Z");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
