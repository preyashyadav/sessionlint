/**
 * End-to-end pipeline test (Phase 2 test gate: "fixture corpus -> verify
 * (mocked API) -> report"). Exercises the whole chain — nominate -> sample
 * -> reconstruct -> replay (FakeApiClient) -> judge (fake JudgeClient) ->
 * stats report -> terminal render — over the real fixture corpus, using
 * only fake clients. No real network/API call happens anywhere here.
 */

import { describe, expect, test } from "bun:test";
import { readdir } from "fs/promises";
import { join } from "path";
import { loadSession } from "../adapters/claude-code/session";
import type { ThreeTierResult } from "./judge/types";
import { threeTierJudge } from "./judge/orchestrate";
import type { JudgeClient } from "./judge/types";
import { FakeApiClient } from "./replay/client";
import { reconstructRequest } from "./replay/reconstruct";
import { replayTurn } from "./replay/replay";
import { stratifiedSample } from "./sample";
import { buildVerifyReport } from "./stats/report";
import { renderVerifyReportTerminal } from "./stats/render";

const REAL_FIXTURES_DIR = join(import.meta.dir, "..", "..", "fixtures");
const SYNTHETIC_DIR = join(REAL_FIXTURES_DIR, "synthetic");
const AS_OF = new Date("2026-07-10");

describe("full verify pipeline: fixture corpus -> mocked replay -> mocked judge -> report", () => {
  test("runs end to end over the whole fixture corpus without touching a real API", async () => {
    const pipelineStart = performance.now();
    const realFiles = (await readdir(REAL_FIXTURES_DIR)).filter((f) => f.endsWith(".jsonl")).map((f) => join(REAL_FIXTURES_DIR, f));
    const syntheticFiles = (await readdir(SYNTHETIC_DIR)).filter((f) => f.endsWith(".jsonl")).map((f) => join(SYNTHETIC_DIR, f));
    const loaded = await Promise.all([...realFiles, ...syntheticFiles].map((p) => loadSession(p)));

    const sampleResult = stratifiedSample(loaded);

    // Fake replay client: always echoes back a deterministic, content-derived reply so the
    // judge step has something stable to compare against — never a real network call.
    const apiClient = new FakeApiClient((request) => ({
      content: [{ type: "text", text: `Echo: ${request.messages.at(-1)?.content ?? ""}` }],
      usage: { input_tokens: 50, output_tokens: 20 },
      stopReason: "end_turn",
    }));

    // Fake judge: a purely content-based (not position-based) equivalence check — real judge
    // prompts/models are never invoked here either.
    const judgeClient: JudgeClient = {
      judge: async ({ responseA, responseB }) => (responseA.trim() === responseB.trim() ? "equivalent" : "not-equivalent"),
    };

    const judgeResults: ThreeTierResult[] = [];
    for (const candidate of sampleResult.sampled) {
      const { session } = loaded.find((l) => l.session.sessionId === candidate.sessionId)!;
      const request = reconstructRequest(session, candidate.turnId);
      if (!request) continue;

      const replayResult = await replayTurn(request, { confirmed: true, apiClient }, AS_OF);
      const replayedText = replayResult.response.content[0]?.text ?? "";

      const turn = session.turns.find((t) => t.turnId === candidate.turnId)!;
      const originalText = turn.entries
        .filter((e) => e.kind === "assistant-message")
        .map((e) => {
          const content = (e.raw as { message?: { content?: unknown } }).message?.content;
          if (!Array.isArray(content)) return "";
          return content
            .filter((b) => b && typeof b === "object" && (b as { type?: unknown }).type === "text")
            .map((b) => (b as { text?: unknown }).text)
            .join("");
        })
        .join("");

      judgeResults.push(await threeTierJudge(candidate.sessionId, candidate.turnId, "task", originalText, replayedText, judgeClient));
    }

    const report = buildVerifyReport(loaded, sampleResult, judgeResults, AS_OF);
    const rendered = renderVerifyReportTerminal(report);

    // Structural assertions (a full byte-exact golden file would be brittle against fixture
    // churn; these pin the pipeline's observable contract instead).
    expect(report.totalNominated).toBeGreaterThan(0);
    expect(report.totalSampled).toBeGreaterThan(0);
    expect(report.perStratum).toHaveLength(3);
    expect(report.overallEquivalenceRateCI.low).toBeGreaterThanOrEqual(0);
    expect(report.overallEquivalenceRateCI.high).toBeLessThanOrEqual(1);
    expect(report.totalSavingsRangeUsd).not.toBeNull();
    expect(report.totalSavingsRangeUsd!.low).toBeGreaterThanOrEqual(0);
    expect(rendered).toContain("candidates nominated");
    expect(rendered).toContain("Recommendation:");
    expect(rendered).toContain("Methodology:");

    // Task 6's "cold npx sessionlint ... < 60s to report" gate, applied to the mocked
    // pipeline as an early regression tripwire (a real 30-day corpus + real API latency is
    // the actual gate, not testable here without live network access).
    const elapsedMs = performance.now() - pipelineStart;
    expect(elapsedMs).toBeLessThan(60_000);
    expect(elapsedMs).toBeLessThan(2_000); // tighter tripwire for this small fixture corpus
  });
});
