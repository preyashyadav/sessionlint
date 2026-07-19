import { describe, expect, test } from "bun:test";
import { sanitizeDisplayText } from "./sanitize";

describe("sanitizeDisplayText", () => {
  test("strips ANSI and C0/C1 controls while preserving readable text", () => {
    expect(sanitizeDisplayText("safe\u001b[2J\u001b[31mred\u001b[0m\nnext\u0007")).toBe(
      "safered next"
    );
  });
});
