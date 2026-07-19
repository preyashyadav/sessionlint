/**
 * Real JudgeClient implementation wrapping the Anthropic SDK.
 *
 * Defaults to Haiku: judging "are these two texts equivalent" is a cheap
 * classification task, not generation, so there's no reason to spend at
 * premium-tier rates for it. A low max_tokens keeps the call short — the
 * judge is asked for exactly one word.
 */

import Anthropic from "@anthropic-ai/sdk";
import { buildJudgePrompt } from "./llm-judge";
import type { JudgeClient, LlmVerdict } from "./types";

export const DEFAULT_JUDGE_MODEL = "claude-haiku-4-5";
const JUDGE_MAX_TOKENS = 16;

export class AnthropicJudgeClient implements JudgeClient {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(client?: Anthropic, model: string = DEFAULT_JUDGE_MODEL) {
    this.client = client ?? new Anthropic();
    this.model = model;
  }

  async judge(request: { taskPrompt: string; responseA: string; responseB: string }): Promise<LlmVerdict> {
    const prompt =
      `${buildJudgePrompt(request.taskPrompt)}\n\n` +
      `Response A:\n${request.responseA}\n\n` +
      `Response B:\n${request.responseB}`;

    const message = await this.client.messages.create({
      model: this.model,
      max_tokens: JUDGE_MAX_TOKENS,
      messages: [{ role: "user", content: prompt }],
    });

    const text = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("")
      .toLowerCase();

    // Check the more specific string first — "not-equivalent" contains "equivalent" as a
    // substring, so a naive .includes("equivalent") check alone would misclassify it.
    if (text.includes("not-equivalent") || text.includes("not equivalent")) return "not-equivalent";
    if (text.includes("equivalent")) return "equivalent";
    return "not-equivalent"; // unparseable response — conservative default, never a silent pass
  }
}
