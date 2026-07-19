import { describe, expect, test } from "bun:test";
import { parseCommandArgv } from "./command-argv";

describe("parseCommandArgv", () => {
  test("preserves quoted arguments without a shell", () => {
    expect(parseCommandArgv(`grep 'foo bar' "file name.txt"`, "--success-check")).toEqual([
      "grep",
      "foo bar",
      "file name.txt",
    ]);
  });

  test("rejects unquoted shell operators instead of silently passing them as argv", () => {
    expect(() => parseCommandArgv("npm test && ./verify.sh", "--success-check")).toThrow(
      /does not invoke a shell/
    );
    expect(() => parseCommandArgv("test | tee out", "--test-command")).toThrow(/shell operators/);
  });

  test("reports malformed quoting", () => {
    expect(() => parseCommandArgv(`grep 'unfinished`, "--success-check")).toThrow(/unclosed/);
  });
});
