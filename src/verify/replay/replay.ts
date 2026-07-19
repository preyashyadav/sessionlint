import { getModelRate } from "../../pricing/rates";
import type { ReconstructedRequest, ReplayOptions, ReplayResult } from "./types";

/**
 * Executes a replay call via the injected ApiClient. Refuses outright
 * unless `options.confirmed === true` — the caller (a human, via the CLI,
 * having seen previewCost()'s output) must have explicitly agreed to spend
 * real money. This is the "mandatory cost preview + explicit confirm
 * before any API call" requirement enforced in code, not just in a CLI
 * prompt that could be skipped. Also refuses outright when
 * `options.paranoid === true` (Task 6's --paranoid flag), regardless of
 * confirmation — paranoid mode disables every network path, no exceptions.
 */
export async function replayTurn(
  request: ReconstructedRequest,
  options: ReplayOptions,
  asOf: Date = new Date()
): Promise<ReplayResult> {
  if (options.paranoid === true) {
    throw new Error("replayTurn refused: --paranoid is active, which disables all network paths, including replay.");
  }
  if (options.confirmed !== true) {
    throw new Error(
      "replayTurn refused: confirmed must be explicitly true. The human must see previewCost()'s " +
        "estimate before any real API call is made — never default this to true."
    );
  }

  const response = await options.apiClient.createMessage({
    model: request.model,
    maxTokens: request.maxTokens,
    messages: request.messages,
  });

  const rate = getModelRate(request.model, asOf);
  const actualCost = rate
    ? (response.usage.input_tokens / 1_000_000) * rate.inputPerMTok +
      (response.usage.output_tokens / 1_000_000) * rate.outputPerMTok
    : 0;

  return { request, response, actualCost };
}
