/**
 * Distinct from run/success-check.ts's SuccessChecker (which only needs an
 * exit code for the model ladder) — the watchdog's repeated-error detector
 * needs actual output text too, to build a comparable failure signature.
 */

export interface TestCommandResult {
  exitCode: number | null;
  output: string;
}

export interface TestCommandRunner {
  run(command: string[], cwd: string): Promise<TestCommandResult>;
}

export const realTestCommandRunner: TestCommandRunner = {
  async run(command, cwd) {
    const proc = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const exitCode = await proc.exited;
    return { exitCode, output: stdout + stderr };
  },
};
