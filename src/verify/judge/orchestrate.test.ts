import { describe, expect, test } from "bun:test";
import { threeTierJudge } from "./orchestrate";
import type { JudgeClient } from "./types";

describe("threeTierJudge: T1 fail is final (Phase 2 spec)", () => {
  test("a mechanical fail never invokes the LLM judge, and finalVerdict is mechanical-fail", async () => {
    let judgeCalls = 0;
    const judgeClient: JudgeClient = {
      judge: async () => {
        judgeCalls++;
        return "equivalent";
      },
    };

    const result = await threeTierJudge(
      "s1",
      "t1",
      "task",
      "See `important.ts` for the fix.",
      "Fixed it, see the file.", // missing the fact token -> T1 fail
      judgeClient
    );

    expect(result.mechanical.verdict).toBe("fail");
    expect(result.llmJudge).toBeNull();
    expect(result.finalVerdict).toBe("mechanical-fail");
    expect(judgeCalls).toBe(0); // never invoked — this is the "final" part of "T1 fail is final"
  });
});

describe("threeTierJudge: T1 pass proceeds to the LLM judge", () => {
  test("a mechanical pass invokes the judge and uses its verdict", async () => {
    const judgeClient: JudgeClient = {
      judge: async ({ responseA, responseB }) => (responseA.trim() === responseB.trim() ? "equivalent" : "not-equivalent"),
    };

    const result = await threeTierJudge("s1", "t1", "task", "All good.", "All good.", judgeClient);
    expect(result.mechanical.verdict).toBe("pass");
    expect(result.llmJudge).not.toBeNull();
    expect(result.finalVerdict).toBe("equivalent");
  });
});
