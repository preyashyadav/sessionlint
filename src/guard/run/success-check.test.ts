import { describe, expect, test } from "bun:test";
import { realSuccessChecker } from "./success-check";

describe("realSuccessChecker", () => {
  test("reports exit code 0 for a passing command", async () => {
    const result = await realSuccessChecker.check({ command: ["true"], cwd: process.cwd() });
    expect(result.exitCode).toBe(0);
  });

  test("reports a non-zero exit code for a failing command", async () => {
    const result = await realSuccessChecker.check({ command: ["false"], cwd: process.cwd() });
    expect(result.exitCode).toBe(1);
  });

  test("reports the command's actual exit code, not just pass/fail", async () => {
    const result = await realSuccessChecker.check({ command: ["bash", "-c", "exit 7"], cwd: process.cwd() });
    expect(result.exitCode).toBe(7);
  });
});
