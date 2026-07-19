/**
 * Ties the whole --verify pipeline together: discover -> sample -> preview
 * cost -> confirm -> replay -> judge -> report. Everything that touches the
 * outside world (the API client, the judge client, and the confirmation
 * prompt itself) is injected, so this function is fully testable with
 * fakes — index.ts is the only place that wires in the real Anthropic
 * clients and a real interactive terminal prompt.
 */

import { defaultRoot, discoverSessions } from "../adapters/claude-code/discover";
import { loadSession, type LoadedSession } from "../adapters/claude-code/session";
import { extractAssistantText, extractPromptText } from "../rules/util";
import { threeTierJudge } from "./judge/orchestrate";
import type { JudgeClient, ThreeTierResult } from "./judge/types";
import { previewCost } from "./replay/cost-preview";
import { reconstructRequest } from "./replay/reconstruct";
import { replayTurn } from "./replay/replay";
import type { ApiClient, ReconstructedRequest } from "./replay/types";
import { stratifiedSample } from "./sample";
import { buildVerifyReport, type ReplayCallFailure, type VerifyReport } from "./stats/report";
import { renderVerifyReportTerminal } from "./stats/render";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 401/403 status, or the credential-shaped messages the SDK throws before a request ever
 * carries a status (e.g. "The ANTHROPIC_API_KEY environment variable is missing or empty"). */
function isAuthFailure(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  if (status === 401 || status === 403) return true;
  return /api[ _-]?key|authentication|unauthorized/i.test(errorMessage(err));
}

export interface RunVerifyOptions {
  root?: string;
  sampleN?: number;
  paranoid: boolean;
  apiClient: ApiClient;
  judgeClient: JudgeClient;
  /** Shown the aggregate cost preview message; return true to proceed with real spend.
   * Injectable so no test ever touches a real terminal prompt. */
  confirm: (previewMessage: string) => Promise<boolean>;
  now?: Date;
}

export type RunVerifyOutcome = "completed" | "declined" | "paranoid-refused" | "no-candidates";

export interface RunVerifyResult {
  outcome: RunVerifyOutcome;
  report?: VerifyReport;
  rendered?: string;
}

export async function runVerify(options: RunVerifyOptions): Promise<RunVerifyResult> {
  if (options.paranoid) {
    return { outcome: "paranoid-refused" };
  }

  const asOf = options.now ?? new Date();
  const root = options.root ?? defaultRoot();

  const discovered = (await discoverSessions(root)).filter((d) => d.kind === "top-level");
  const loaded: LoadedSession[] = [];
  for (const d of discovered) loaded.push(await loadSession(d.filePath, d.sessionId));

  const sampleResult = stratifiedSample(loaded, { n: options.sampleN });

  const requests: Array<{ sessionId: string; turnId: string; loadedSession: LoadedSession; request: ReconstructedRequest }> = [];
  for (const candidate of sampleResult.sampled) {
    const loadedSession = loaded.find((l) => l.session.sessionId === candidate.sessionId);
    if (!loadedSession) continue;
    const request = reconstructRequest(loadedSession.session, candidate.turnId);
    if (request) requests.push({ sessionId: candidate.sessionId, turnId: candidate.turnId, loadedSession, request });
  }

  if (requests.length === 0) {
    return { outcome: "no-candidates" };
  }

  let totalLow = 0;
  let totalHigh = 0;
  for (const { request } of requests) {
    const preview = previewCost(request);
    totalLow += preview.estimatedCostRange.low;
    totalHigh += preview.estimatedCostRange.high;
  }

  const previewMessage =
    `This will make ${requests.length} replay call(s) and up to ${requests.length * 2} judge call(s).\n` +
    `Estimated replay cost: $${totalLow.toFixed(2)}-$${totalHigh.toFixed(2)} ` +
    "(a rough chars/4 token estimate, not exact — see previewCost's docs; judge calls are extra, on a cheap model).";

  const confirmed = await options.confirm(previewMessage);
  if (!confirmed) {
    return { outcome: "declined" };
  }

  const judgeResults: ThreeTierResult[] = [];
  const failures: ReplayCallFailure[] = [];
  let skippedAfterAuthFailure = 0;
  for (let i = 0; i < requests.length; i++) {
    const { sessionId, turnId, loadedSession, request } = requests[i]!;
    try {
      const replayResult = await replayTurn(request, { confirmed: true, apiClient: options.apiClient }, asOf);
      const replayedText = replayResult.response.content.find((b) => b.type === "text")?.text ?? "";

      const turn = loadedSession.session.turns.find((t) => t.turnId === turnId);
      if (!turn) continue;

      const originalText = extractAssistantText(turn);
      const taskPrompt = extractPromptText(turn) ?? "";

      judgeResults.push(await threeTierJudge(sessionId, turnId, taskPrompt, originalText, replayedText, options.judgeClient));
    } catch (err) {
      // A single failed replay/judge call (rate limit, transient network error) shouldn't
      // abort the whole run — but it must be RECORDED, never silently swallowed: the user
      // confirmed real spend and deserves to know which calls produced no verdict.
      failures.push({ sessionId, turnId, message: errorMessage(err) });
      if (isAuthFailure(err)) {
        // Auth failures aren't transient — every remaining call fails identically, so
        // grinding through the rest of the sample only repeats the same error.
        skippedAfterAuthFailure = requests.length - i - 1;
        break;
      }
    }
  }

  const report = buildVerifyReport(loaded, sampleResult, judgeResults, asOf, { failures, skippedAfterAuthFailure });
  const rendered = renderVerifyReportTerminal(report);
  return { outcome: "completed", report, rendered };
}
