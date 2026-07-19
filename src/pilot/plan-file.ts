import { readFile } from "fs/promises";
import { join } from "path";
import { parsePlanItems, type PlanItem } from "./plan-items";

export const PLAN_FILE_CANDIDATES = ["TODO.md", "todo.md", "plan.md", "PLAN.md"];

/** Returns null if no recognized plan file exists in cwd — a real absence, not an error. */
export async function findPlanFilePath(cwd: string): Promise<string | null> {
  for (const candidate of PLAN_FILE_CANDIDATES) {
    const path = join(cwd, candidate);
    try {
      await readFile(path, "utf8");
      return path;
    } catch {
      continue;
    }
  }
  return null;
}

/** Returns null if no recognized plan file exists in cwd — a real absence, not an error. */
export async function readPlanItems(cwd: string): Promise<PlanItem[] | null> {
  const path = await findPlanFilePath(cwd);
  if (!path) return null;
  const content = await readFile(path, "utf8");
  return parsePlanItems(content);
}
