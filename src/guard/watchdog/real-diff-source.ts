import type { DiffSource } from "./types";

export const realDiffSource: DiffSource = {
  async diffBetween(cwd, from, to) {
    if (!from) return "";
    const proc = Bun.spawn(["git", "diff", `${from}..${to}`], { cwd, stdout: "pipe", stderr: "ignore" });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    return stdout;
  },
};

const SIGNATURE_LINE_COUNT = 5;

/** A short, comparable signature from a test command's combined output — enough to tell
 * "the same failure" from "a different failure," without storing arbitrarily large output. */
export function buildTestOutputSignature(output: string): string {
  return output.split("\n").slice(0, SIGNATURE_LINE_COUNT).join("\n").trim();
}
