/**
 * Native desktop notification dispatch (macOS via `osascript`, Linux via
 * `notify-send`). Uses spawn with an argument array, never a shell string —
 * no command-injection surface even though the message text is our own
 * generated advisory, not raw user input. Unsupported platforms/missing
 * binaries degrade to `false` (a named "notification not sent"), never a
 * crash — desktop notifications are a nice-to-have signal, not something
 * that should ever break the credits sentinel's core threshold logic.
 */

import { spawn } from "child_process";

/** Set SESSIONLINT_NO_NOTIFY=1 to suppress real OS notifications (CI, tests, or users who
 * want the text/log signal without a desktop popup). */
export async function sendDesktopNotification(title: string, message: string): Promise<boolean> {
  if (process.env["SESSIONLINT_NO_NOTIFY"]) return false;
  if (process.platform === "darwin") {
    return runCommand("osascript", ["-e", `display notification ${appleScriptString(message)} with title ${appleScriptString(title)}`]);
  }
  if (process.platform === "linux") {
    return runCommand("notify-send", [title, message]);
  }
  return false;
}

function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function runCommand(command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const proc = spawn(command, args, { stdio: "ignore" });
      proc.on("error", () => resolve(false));
      proc.on("exit", (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
}
