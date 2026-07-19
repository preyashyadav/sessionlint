import { llmJudge } from "./llm-judge";
import { mechanicalCheck } from "./mechanical";
import type { JudgeClient, ThreeTierResult } from "./types";

/** T1 -> T2 pipeline. A T1 fail short-circuits — the LLM judge is never called (final). */
export async function threeTierJudge(
  sessionId: string,
  turnId: string,
  taskPrompt: string,
  original: string,
  replayed: string,
  judgeClient: JudgeClient
): Promise<ThreeTierResult> {
  const mechanical = mechanicalCheck(original, replayed);
  if (mechanical.verdict === "fail") {
    return { sessionId, turnId, mechanical, llmJudge: null, finalVerdict: "mechanical-fail" };
  }

  const judgeResult = await llmJudge(judgeClient, taskPrompt, original, replayed);
  return { sessionId, turnId, mechanical, llmJudge: judgeResult, finalVerdict: judgeResult.verdict };
}
