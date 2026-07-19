import { describe, expect, test } from "bun:test";
import { sendDesktopNotification } from "./desktop-notify";

describe("sendDesktopNotification", () => {
  test("resolves to a boolean rather than throwing, regardless of platform/binary availability", async () => {
    const result = await sendDesktopNotification("sessionlint", "test notification");
    expect(typeof result).toBe("boolean");
  });

  test("a message containing quotes/backslashes doesn't break the call", async () => {
    const result = await sendDesktopNotification("sessionlint", `quote " and backslash \\ test`);
    expect(typeof result).toBe("boolean");
  });

  test("SESSIONLINT_NO_NOTIFY suppresses the real OS call", async () => {
    const original = process.env["SESSIONLINT_NO_NOTIFY"];
    process.env["SESSIONLINT_NO_NOTIFY"] = "1";
    try {
      expect(await sendDesktopNotification("sessionlint", "should be suppressed")).toBe(false);
    } finally {
      if (original === undefined) delete process.env["SESSIONLINT_NO_NOTIFY"];
      else process.env["SESSIONLINT_NO_NOTIFY"] = original;
    }
  });
});
