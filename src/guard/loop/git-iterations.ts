/**
 * Iteration-boundary signal for `sessionlint loop`: treats each new git
 * commit in the wrapped project as one iteration. This is an ASSUMPTION
 * about Ralph-style loop-runner convention (commit-per-iteration), not a
 * verified fact about any specific real loop runner — flagged in
 * MASTER.md §7/§9. Degrades to "unknown" (null), never a fabricated count,
 * when the directory isn't a git repo or has no commits yet.
 */

export async function getHeadCommit(cwd: string): Promise<string | null> {
  const proc = Bun.spawn(["git", "rev-parse", "HEAD"], { cwd, stdout: "pipe", stderr: "ignore" });
  const stdout = (await new Response(proc.stdout).text()).trim();
  const exitCode = await proc.exited;
  return exitCode === 0 && stdout ? stdout : null;
}
