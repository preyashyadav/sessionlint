import { describe, expect, test } from "bun:test";
import { mechanicalCheck } from "./mechanical";

describe("mechanicalCheck", () => {
  test("passes when all fact tokens from the original survive in the replayed text", () => {
    const original = "Fixed the bug in `auth.ts` at line 42.";
    const replayed = "The bug in `auth.ts` on line 42 is now fixed.";
    expect(mechanicalCheck(original, replayed).verdict).toBe("pass");
  });

  test("fails when a fact token from the original is missing from the replayed text", () => {
    const original = "Fixed the bug in `auth.ts` at line 42.";
    const replayed = "Fixed the bug in a different file.";
    const result = mechanicalCheck(original, replayed);
    expect(result.verdict).toBe("fail");
    expect(result.reasons.some((r) => r.includes("auth.ts"))).toBe(true);
  });

  test("fails when the replayed response is empty but the original was not", () => {
    const result = mechanicalCheck("Some real content here.", "");
    expect(result.verdict).toBe("fail");
    expect(result.reasons[0]).toContain("empty");
  });

  test("passes trivially when the original has no extractable fact tokens (plain prose)", () => {
    const result = mechanicalCheck("This looks good to me.", "Looks good, agreed.");
    expect(result.verdict).toBe("pass");
    expect(result.reasons).toEqual([]);
  });

  test("a T1 fail is final — always includes at least one reason", () => {
    const result = mechanicalCheck("See `config.json` for details.", "See the settings file.");
    expect(result.verdict).toBe("fail");
    expect(result.reasons.length).toBeGreaterThan(0);
  });
});
