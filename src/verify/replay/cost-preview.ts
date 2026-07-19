/**
 * Cost preview (Phase 2, Task 3: "Mandatory cost preview + explicit confirm
 * before any API call"). Always a range (D-004), never a point — token
 * counts here come from a crude chars/4 estimate (no real tokenizer
 * available without a live count_tokens call, which is itself a network
 * action gated behind D-003's opt-in-only rule and not wired in this
 * codebase). The range brackets that estimation uncertainty (±30%) plus
 * whether the output budget cap gets fully consumed.
 */

import { getModelRate } from "../../pricing/rates";
import type { CostPreview, ReconstructedRequest } from "./types";

const TOKEN_ESTIMATE_CHARS_PER_TOKEN = 4;
const TOKEN_ESTIMATE_UNCERTAINTY = 0.3;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / TOKEN_ESTIMATE_CHARS_PER_TOKEN);
}

export function previewCost(request: ReconstructedRequest): CostPreview {
  const inputText = request.messages.map((m) => m.content).join("\n");
  const estimatedInputTokens = estimateTokens(inputText);

  const rate = getModelRate(request.model);
  if (!rate) {
    return {
      model: request.model,
      estimatedInputTokens,
      maxOutputTokens: request.maxTokens,
      estimatedCostRange: { low: 0, high: 0 },
    };
  }

  const inputCost = (estimatedInputTokens / 1_000_000) * rate.inputPerMTok;
  const outputCostAtCap = (request.maxTokens / 1_000_000) * rate.outputPerMTok;

  return {
    model: request.model,
    estimatedInputTokens,
    maxOutputTokens: request.maxTokens,
    estimatedCostRange: {
      low: inputCost * (1 - TOKEN_ESTIMATE_UNCERTAINTY),
      high: inputCost * (1 + TOKEN_ESTIMATE_UNCERTAINTY) + outputCostAtCap,
    },
  };
}
