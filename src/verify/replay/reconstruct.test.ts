import { describe, expect, test } from "bun:test";
import { join } from "path";
import { loadSession } from "../../adapters/claude-code/session";
import { downgradeModelFor } from "./downgrade";
import { reconstructRequest } from "./reconstruct";

const SYNTHETIC_DIR = join(import.meta.dir, "..", "..", "..", "fixtures", "synthetic");

describe("downgradeModelFor", () => {
  test("opus downgrades to sonnet-5, fable/mythos downgrade to opus-4-8", () => {
    expect(downgradeModelFor("claude-opus-4-8")).toBe("claude-sonnet-5");
    expect(downgradeModelFor("claude-fable-5")).toBe("claude-opus-4-8");
    expect(downgradeModelFor("claude-mythos-5")).toBe("claude-opus-4-8");
  });

  test("no sensible downgrade for an already-cheap model", () => {
    expect(downgradeModelFor("claude-sonnet-5")).toBeNull();
    expect(downgradeModelFor("claude-haiku-4-5")).toBeNull();
  });
});

describe("reconstructRequest", () => {
  test("a first-turn candidate (no prior history) reconstructs to just its own prompt", async () => {
    const { session } = await loadSession(join(SYNTHETIC_DIR, "model-switch.jsonl"));
    const candidateTurnId = session.turns[0]!.turnId;
    const request = reconstructRequest(session, candidateTurnId);

    expect(request).not.toBeNull();
    expect(request?.originalModel).toBe("claude-opus-4-8");
    expect(request?.model).toBe("claude-sonnet-5");
    expect(request?.messages).toEqual([{ role: "user", content: "Write a quick script to parse this CSV" }]);
    expect(request?.systemPromptOmitted).toBe(true);
    expect(request?.toolContentOmitted).toBe(true);
  });

  test("a later-turn candidate includes prior turns' text as history, ending on the candidate's own prompt", async () => {
    const { session } = await loadSession(join(SYNTHETIC_DIR, "missing-clear.jsonl"));
    const secondTurnId = session.turns[1]!.turnId;
    const request = reconstructRequest(session, secondTurnId);

    expect(request?.messages).toEqual([
      { role: "user", content: "Let's start a long research task" },
      { role: "assistant", content: "Digging in." },
      { role: "user", content: "Now pivot to a completely different topic" },
    ]);
    // Alternates correctly and ends on user, as the Messages API requires.
    expect(request?.messages.at(-1)?.role).toBe("user");
  });

  test("returns null for an unknown turnId", async () => {
    const { session } = await loadSession(join(SYNTHETIC_DIR, "model-switch.jsonl"));
    expect(reconstructRequest(session, "nonexistent-turn-id")).toBeNull();
  });

  test("returns null when the turn's model has no sensible downgrade (already-cheap model)", async () => {
    const { session } = await loadSession(join(SYNTHETIC_DIR, "minimal-session.jsonl"));
    const turnId = session.turns[0]!.turnId; // sonnet-5, no downgrade
    expect(reconstructRequest(session, turnId)).toBeNull();
  });

  test("maxTokens defaults to DEFAULT_MAX_TOKENS and is overridable", async () => {
    const { session } = await loadSession(join(SYNTHETIC_DIR, "model-switch.jsonl"));
    const turnId = session.turns[0]!.turnId;
    const defaultRequest = reconstructRequest(session, turnId);
    const customRequest = reconstructRequest(session, turnId, 8192);
    expect(defaultRequest?.maxTokens).toBe(4096);
    expect(customRequest?.maxTokens).toBe(8192);
  });
});
