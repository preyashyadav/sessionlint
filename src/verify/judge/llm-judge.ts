/**
 * T2 LLM-judge (Phase 2, Task 4). Hidden identities: the judge only ever
 * sees "Response A"/"Response B", never which one is original vs replayed.
 * Both orders are judged (position-bias control) — the same pair is judged
 * twice with the labeling swapped, and disagreement between the two orders
 * always resolves to "uncertain", never a pass (the spec's own words: "a
 * pass" here means returning "equivalent" — disagreement can never produce
 * that verdict, regardless of which order happened to say "equivalent").
 */

import type { JudgeClient, LlmJudgeResult } from "./types";

export function buildJudgePrompt(taskPrompt: string): string {
  return (
    `You are comparing two AI responses to the same task for equivalence in correctness ` +
    `and completeness. Task: ${taskPrompt}\n\n` +
    `Respond with exactly one word: "equivalent" or "not-equivalent".`
  );
}

export async function llmJudge(
  client: JudgeClient,
  taskPrompt: string,
  original: string,
  replayed: string
): Promise<LlmJudgeResult> {
  const orderAVerdict = await client.judge({ taskPrompt, responseA: original, responseB: replayed });
  const orderBVerdict = await client.judge({ taskPrompt, responseA: replayed, responseB: original });

  return {
    verdict: orderAVerdict === orderBVerdict ? orderAVerdict : "uncertain",
    orderAVerdict,
    orderBVerdict,
  };
}
