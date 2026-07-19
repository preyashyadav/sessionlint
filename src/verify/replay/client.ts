import type { ApiClient, ApiMessageResponse, ReplayMessage } from "./types";

/**
 * Fake client for tests — this codebase has no real ApiClient implementation
 * yet and never calls a live API. A real implementation would wrap the
 * Anthropic SDK's streaming `.messages.stream()` + `.finalMessage()` (per
 * the phase spec's "streaming replay with per-call budget cap"), gated
 * behind the same explicit human confirmation replay.ts already requires.
 */
export class FakeApiClient implements ApiClient {
  constructor(
    private readonly responder:
      | ApiMessageResponse
      | ((request: { model: string; maxTokens: number; messages: ReplayMessage[] }) => ApiMessageResponse)
  ) {}

  async createMessage(request: {
    model: string;
    maxTokens: number;
    messages: ReplayMessage[];
  }): Promise<ApiMessageResponse> {
    return typeof this.responder === "function" ? this.responder(request) : this.responder;
  }
}
