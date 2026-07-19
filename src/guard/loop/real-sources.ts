import { costSince } from "./project-cost";
import { getHeadCommit } from "./git-iterations";
import type { CommitSource, CostSource } from "./types";

export const realCostSource: CostSource = { costSince };
export const realCommitSource: CommitSource = { getHeadCommit };
