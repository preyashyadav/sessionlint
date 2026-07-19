/**
 * Real ApiClient implementation wrapping the Anthropic SDK.
 *
 * Zero-arg `new Anthropic()` resolves credentials automatically —
 * ANTHROPIC_API_KEY, then ANTHROPIC_AUTH_TOKEN, then an `ant auth login`
 * profile, then Workload Identity Federation — so there's no key handling
 * to write here.
 *
 * Uses streaming (`.messages.stream()` + `.finalMessage()`) rather than a
 * plain `.create()` call, per Anthropic's own guidance to default to
 * streaming for requests that may involve long input/output — a replay
 * request carries a full reconstructed conversation history plus a
 * multi-thousand-token output budget cap.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ApiClient, ApiMessageResponse, ReplayMessage } from "./types";

export class AnthropicApiClient implements ApiClient {
  private readonly client: Anthropic;

  constructor(client?: Anthropic) {
    this.client = client ?? new Anthropic();
  }

  async createMessage(request: {
    model: string;
    maxTokens: number;
    messages: ReplayMessage[];
  }): Promise<ApiMessageResponse> {
    const stream = this.client.messages.stream({
      model: request.model,
      max_tokens: request.maxTokens,
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
    });

    const finalMessage = await stream.finalMessage();

    return {
      content: finalMessage.content.map((block) => ({
        type: block.type,
        text: block.type === "text" ? block.text : undefined,
      })),
      usage: {
        input_tokens: finalMessage.usage.input_tokens,
        output_tokens: finalMessage.usage.output_tokens,
      },
      stopReason: finalMessage.stop_reason,
    };
  }
}
