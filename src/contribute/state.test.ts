import { describe, expect, test } from "bun:test";
import { assignPseudonyms, pseudonymFor, validateHandle } from "./state";

describe("validateHandle", () => {
  test("accepts an ordinary nickname", () => {
    expect(validateHandle("  alice_b ")).toEqual({ ok: true, handle: "alice_b" });
  });
  // An email in the handle would land in the subject line of a public-ish corpus.
  test("rejects an email address", () => {
    const r = validateHandle("alice@example.com");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("email");
  });
  test("rejects too short, too long, and exotic characters", () => {
    expect(validateHandle("a").ok).toBe(false);
    expect(validateHandle("x".repeat(33)).ok).toBe(false);
    expect(validateHandle("alice/../etc").ok).toBe(false);
  });
});

describe("pseudonyms", () => {
  test("first 26 are single letters, then it rolls over", () => {
    expect(pseudonymFor(0)).toBe("project-a");
    expect(pseudonymFor(25)).toBe("project-z");
    expect(pseudonymFor(26)).toBe("project-aa");
  });
  test("assignment is stable across calls — a project keeps its alias", () => {
    const map: Record<string, string> = {};
    assignPseudonyms(map, ["proj-one", "proj-two"]);
    const first = { ...map };
    assignPseudonyms(map, ["proj-two", "proj-three"]);
    expect(map["proj-one"]).toBe(first["proj-one"]!);
    expect(map["proj-two"]).toBe(first["proj-two"]!);
    expect(map["proj-three"]).toBeDefined();
  });
  test("never reuses an alias already taken", () => {
    const map: Record<string, string> = { existing: "project-a" };
    assignPseudonyms(map, ["fresh"]);
    expect(map["fresh"]).not.toBe("project-a");
    expect(new Set(Object.values(map)).size).toBe(2);
  });
});
