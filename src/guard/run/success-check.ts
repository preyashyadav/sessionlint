import type { SuccessChecker } from "./types";

/** Real implementation: runs the given command and reports its exit code. Safe to use
 * directly in tests (unlike ClaudeRunner) — it's just a local subprocess, not a billed API call. */
export const realSuccessChecker: SuccessChecker = {
  async check({ command, cwd }) {
    const proc = Bun.spawn(command, { cwd, stdout: "ignore", stderr: "ignore" });
    const exitCode = await proc.exited;
    return { exitCode };
  },
};
