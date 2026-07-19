/**
 * Replay engine types (Phase 2, Task 3).
 *
 * IMPORTANT LIMITATION (verified against real Claude Code JSONL, not
 * assumed): the system prompt is never logged in the transcript — checked
 * a real assistant message object's keys directly (model, id, type, role,
 * content, stop_reason, stop_sequence, stop_details, usage, diagnostics —
 * no system field, and no sibling file carries it either). "Exact request
 * reconstruction" per the phase spec is therefore not achievable from
 * JSONL alone. Per human decision: replay WITHOUT a system prompt, and
 * disclose this prominently (every ReconstructedRequest carries
 * `systemPromptOmitted: true`; Task 5's methodology footer must surface
 * it). A second, compounding limitation: tool_use/tool_result blocks in
 * prior turns are also dropped from reconstructed history — replaying
 * Claude Code's own local tool side effects isn't meaningful or safe, so
 * only human/assistant TEXT content is reconstructed.
 */

export type ReplayRole = "user" | "assistant";

export interface ReplayMessage {
  role: ReplayRole;
  content: string;
}

export interface ReconstructedRequest {
  sessionId: string;
  turnId: string;
  originalModel: string;
  /** The cheaper model being tested as a substitute for originalModel. */
  model: string;
  messages: ReplayMessage[];
  maxTokens: number;
  /** Always true — see the module-level limitation note above. */
  systemPromptOmitted: true;
  /** Always true — tool_use/tool_result content is never replayed. */
  toolContentOmitted: true;
}

export interface CostPreview {
  model: string;
  estimatedInputTokens: number;
  /** The budget cap, not a prediction of what the model will actually produce. */
  maxOutputTokens: number;
  /** A range, never a point estimate (D-004) — token-count estimation without a real
   * tokenizer call is inherently approximate. */
  estimatedCostRange: { low: number; high: number };
}

export interface ApiMessageResponse {
  content: Array<{ type: string; text?: string }>;
  usage: { input_tokens: number; output_tokens: number };
  stopReason: string | null;
}

/** Injectable so every test uses a fake client — this codebase never calls a real API. */
export interface ApiClient {
  createMessage(request: {
    model: string;
    maxTokens: number;
    messages: ReplayMessage[];
  }): Promise<ApiMessageResponse>;
}

export interface ReplayOptions {
  /** Must be explicitly true — the caller (a human, via the CLI's confirmation prompt)
   * has seen the cost preview and agreed to spend real money. Never default true. */
  confirmed: boolean;
  /** Set when the CLI's --paranoid flag is active (Task 6, D-003: read-only by default,
   * network paths are opt-in). Defaults to false (network allowed) only because this
   * codebase has no real network-calling ApiClient yet — wired here, at the lowest level,
   * so a future real implementation inherits the guard automatically rather than relying on
   * every call site to remember to check the flag itself. */
  paranoid?: boolean;
  apiClient: ApiClient;
}

export interface ReplayResult {
  request: ReconstructedRequest;
  response: ApiMessageResponse;
  actualCost: number;
}
