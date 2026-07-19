import { describe, expect, test } from "bun:test";
import { join } from "path";
import { loadSession } from "../adapters/claude-code/session";
import { hasSecretPattern, precededByStatefulTool } from "./exclude";

const SYNTHETIC_DIR = join(import.meta.dir, "..", "..", "fixtures", "synthetic");

describe("hasSecretPattern (redaction test — required by the phase spec)", () => {
  test("detects a secret embedded in the assistant's own response text", async () => {
    const { session } = await loadSession(join(SYNTHETIC_DIR, "secret-in-turn.jsonl"));
    const turn = session.turns[0]!;
    expect(hasSecretPattern(turn)).toBe(true);
  });

  test("a clean turn with no secret-shaped text is not flagged", async () => {
    const { session } = await loadSession(join(SYNTHETIC_DIR, "model-switch.jsonl"));
    for (const turn of session.turns) {
      expect(hasSecretPattern(turn)).toBe(false);
    }
  });
});

describe("precededByStatefulTool", () => {
  test("a text turn immediately after a Write turn is flagged", async () => {
    const { session } = await loadSession(join(SYNTHETIC_DIR, "stateful-contamination.jsonl"));
    const summaryTurn = session.turns[1]!;
    expect(precededByStatefulTool(session, summaryTurn)).toBe(true);
  });

  test("the first turn in a session is never flagged (nothing precedes it)", async () => {
    const { session } = await loadSession(join(SYNTHETIC_DIR, "stateful-contamination.jsonl"));
    const firstTurn = session.turns[0]!;
    expect(precededByStatefulTool(session, firstTurn)).toBe(false);
  });

  test("a turn preceded by a tool-call-free turn is not flagged", async () => {
    const { session } = await loadSession(join(SYNTHETIC_DIR, "model-switch.jsonl"));
    const secondTurn = session.turns[1]!;
    expect(precededByStatefulTool(session, secondTurn)).toBe(false);
  });

  test("narrowed rule: a turn preceded by an edit is NOT flagged when its text never references that file", async () => {
    const { session } = await loadSession(join(SYNTHETIC_DIR, "stateful-unrelated.jsonl"));
    const secondTurn = session.turns[1]!;
    expect(precededByStatefulTool(session, secondTurn)).toBe(false);
  });
});
