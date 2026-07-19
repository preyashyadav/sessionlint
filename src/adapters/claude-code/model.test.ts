import { describe, expect, test } from "bun:test";
import { isValidModelShape } from "./model";

describe("isValidModelShape", () => {
  test("accepts real known model slugs", () => {
    expect(isValidModelShape("claude-opus-4-8")).toBe(true);
    expect(isValidModelShape("claude-sonnet-5")).toBe(true);
    expect(isValidModelShape("claude-fable-5")).toBe(true);
  });

  test("accepts a plausible future model name not on any allowlist", () => {
    expect(isValidModelShape("claude-haiku-9-turbo")).toBe(true);
  });

  test("rejects null/undefined/empty", () => {
    expect(isValidModelShape(null)).toBe(false);
    expect(isValidModelShape(undefined)).toBe(false);
    expect(isValidModelShape("")).toBe(false);
  });

  test("rejects the real corrupted fixture value (sanitizer-mangled prose)", () => {
    expect(isValidModelShape("lorem ipsum dolor sit amet consectetur a")).toBe(false);
  });

  test("rejects any whitespace-containing string", () => {
    expect(isValidModelShape("not a model")).toBe(false);
  });

  test("rejects overlong strings", () => {
    expect(isValidModelShape("a".repeat(65))).toBe(false);
  });

  test("accepts a 64-char boundary string", () => {
    expect(isValidModelShape("a".repeat(64))).toBe(true);
  });
});
