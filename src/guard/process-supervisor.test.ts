import { describe, expect, test } from "bun:test";
import { startSupervisedProcess } from "./process-supervisor";

describe("startSupervisedProcess", () => {
  test("captures stdout and stderr line-by-line and reports a natural exit code", async () => {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const handle = startSupervisedProcess({
      command: ["bash", "-c", "echo out-line; echo err-line 1>&2; exit 3"],
      onStdoutLine: (l) => stdoutLines.push(l),
      onStderrLine: (l) => stderrLines.push(l),
    });
    const exitInfo = await handle.exited;
    expect(exitInfo.exitCode).toBe(3);
    expect(stdoutLines).toEqual(["out-line"]);
    expect(stderrLines).toEqual(["err-line"]);
  });

  // NOTE: these use `sleep 30 & wait "$!"`, not a plain foreground `sleep 30`. Verified
  // directly (see MASTER.md §7): bash defers running a trap handler until the current
  // foreground *external* command exits on its own — a documented bash behavior, not a bug —
  // so a plain foreground `sleep 30` would never let the trap interrupt it promptly. Running
  // sleep in the background and blocking on the `wait` builtin instead makes the trap fire
  // immediately, which is what actually simulates "a child that responds properly to SIGTERM."

  test("a child that traps SIGTERM and exits cleanly stops gracefully, well within the timeout", async () => {
    const handle = startSupervisedProcess({
      command: ["bash", "-c", "trap 'exit 0' TERM; sleep 30 & wait \"$!\""],
      gracefulTimeoutMs: 5000,
    });
    const start = Date.now();
    const outcome = await handle.requestStop("budget exceeded");
    const elapsedMs = Date.now() - start;
    expect(outcome.stoppedGracefully).toBe(true);
    expect(outcome.reason).toBe("budget exceeded");
    expect(elapsedMs).toBeLessThan(4000); // nowhere near the full sleep 30 or the 5s grace window
  });

  test("a child that ignores SIGTERM is escalated to SIGKILL after the grace period", async () => {
    const handle = startSupervisedProcess({
      command: ["bash", "-c", "trap '' TERM; sleep 30 & wait \"$!\""],
      gracefulTimeoutMs: 300,
    });
    // Give bash a moment to actually register the trap before signaling — without this, SIGTERM
    // can race ahead of `trap ''` executing, hitting the (non-ignored) default action instead.
    await Bun.sleep(200);
    const outcome = await handle.requestStop("budget exceeded");
    expect(outcome.stoppedGracefully).toBe(false);
    const exitInfo = await handle.exited;
    expect(exitInfo.signalCode).toBe("SIGKILL");
  });

  test("calling requestStop twice concurrently only runs one stop sequence", async () => {
    const handle = startSupervisedProcess({
      command: ["bash", "-c", "trap 'exit 0' TERM; sleep 30 & wait \"$!\""],
      gracefulTimeoutMs: 5000,
    });
    const [first, second] = await Promise.all([handle.requestStop("a"), handle.requestStop("b")]);
    expect(first).toEqual(second); // same in-flight promise resolved to both callers
  });

  test("drains a large volume of output without hanging, even with no line callback", async () => {
    const handle = startSupervisedProcess({
      command: ["bash", "-c", "for i in $(seq 1 5000); do echo line-$i; done"],
    });
    const exitInfo = await handle.exited;
    expect(exitInfo.exitCode).toBe(0);
  });
});
