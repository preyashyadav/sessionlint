/** Best-effort request reconstruction (see types.ts for the two disclosed limitations:
 * no system prompt, no tool_use/tool_result content). */

import type { Entry, Session, Turn } from "../../adapters/claude-code/types";
import { extractPromptText } from "../../rules/util";
import { downgradeModelFor } from "./downgrade";
import type { ReconstructedRequest, ReplayMessage } from "./types";

export const DEFAULT_MAX_TOKENS = 4096;

function entryText(entry: Entry): string | null {
  const raw = entry.raw as { message?: { content?: unknown } };
  const content = raw.message?.content;
  if (typeof content === "string" && content.length > 0) return content.trim();
  if (Array.isArray(content)) {
    const texts: string[] = [];
    for (const block of content) {
      if (block && typeof block === "object" && (block as { type?: unknown }).type === "text") {
        const text = (block as { text?: unknown }).text;
        if (typeof text === "string" && text.length > 0) texts.push(text);
      }
    }
    if (texts.length > 0) return texts.join("\n").trim();
  }
  return null;
}

/** Text-only messages for a turn — tool_use/tool_result entries are dropped entirely. */
function turnToMessages(turn: Turn): ReplayMessage[] {
  const messages: ReplayMessage[] = [];
  for (const entry of turn.entries) {
    if (entry.kind === "user-message") {
      const text = entryText(entry);
      if (text) messages.push({ role: "user", content: text });
    } else if (entry.kind === "assistant-message") {
      const text = entryText(entry);
      if (text) messages.push({ role: "assistant", content: text });
    }
  }
  return messages;
}

/** Reconstructs the request for replaying `turnId` on a downgraded model. Returns null when
 * the turn can't be found, has no valid model, has no available downgrade target, or has no
 * extractable initiating prompt — never throws, per C-1's graceful-degradation spirit. */
export function reconstructRequest(
  session: Session,
  turnId: string,
  maxTokens: number = DEFAULT_MAX_TOKENS
): ReconstructedRequest | null {
  const index = session.turns.findIndex((t) => t.turnId === turnId);
  if (index === -1) return null;

  const candidate = session.turns[index]!;
  if (!candidate.model) return null;

  const downgradeModel = downgradeModelFor(candidate.model);
  if (!downgradeModel) return null;

  const candidatePrompt = extractPromptText(candidate);
  if (!candidatePrompt) return null;

  const messages: ReplayMessage[] = [];
  for (let i = 0; i < index; i++) {
    messages.push(...turnToMessages(session.turns[i]!));
  }
  messages.push({ role: "user", content: candidatePrompt });

  return {
    sessionId: session.sessionId,
    turnId: candidate.turnId,
    originalModel: candidate.model,
    model: downgradeModel,
    messages,
    maxTokens,
    systemPromptOmitted: true,
    toolContentOmitted: true,
  };
}
