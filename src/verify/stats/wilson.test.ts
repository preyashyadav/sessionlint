import { describe, expect, test } from "bun:test";
import { wilsonInterval } from "./wilson";

describe("wilsonInterval: correctness against known (analytically exact) values", () => {
  test("k=0 (zero successes): low bound is exactly 0 for any n and z", () => {
    // Provable directly from the formula: at p=0, center = margin = z²/(2n+z²), so low = 0 exactly.
    expect(wilsonInterval(0, 10).low).toBe(0);
    expect(wilsonInterval(0, 40).low).toBe(0);
    expect(wilsonInterval(0, 100, 1.645).low).toBe(0);
  });

  test("k=n (all successes): high bound is exactly 1 for any n and z (symmetric to the k=0 case)", () => {
    expect(wilsonInterval(10, 10).high).toBe(1);
    expect(wilsonInterval(40, 40).high).toBe(1);
    expect(wilsonInterval(100, 100, 1.645).high).toBe(1);
  });

  test("p=0.5 (k=n/2): the interval is exactly centered on 0.5 for any n", () => {
    // Provable directly: numerator (p + z²/2n) = 0.5*(1 + z²/n) exactly when p=0.5.
    for (const n of [2, 10, 40, 100]) {
      const { low, high } = wilsonInterval(n / 2, n);
      expect((low + high) / 2).toBeCloseTo(0.5, 10);
    }
  });

  test("no trials at all: the widest possible honest bound, [0, 1]", () => {
    expect(wilsonInterval(0, 0)).toEqual({ low: 0, high: 1 });
  });
});

describe("wilsonInterval: sanity properties", () => {
  test("the interval always contains the point estimate p_hat", () => {
    const cases: [number, number][] = [
      [3, 10],
      [8, 10],
      [20, 40],
      [1, 3],
    ];
    for (const [k, n] of cases) {
      const { low, high } = wilsonInterval(k, n);
      const p = k / n;
      expect(p).toBeGreaterThanOrEqual(low);
      expect(p).toBeLessThanOrEqual(high);
    }
  });

  test("bounds are always within [0, 1]", () => {
    for (const [k, n] of [
      [0, 5],
      [5, 5],
      [2, 5],
    ] as const) {
      const { low, high } = wilsonInterval(k, n);
      expect(low).toBeGreaterThanOrEqual(0);
      expect(high).toBeLessThanOrEqual(1);
      expect(low).toBeLessThanOrEqual(high);
    }
  });

  test("the interval narrows as n grows for the same observed rate", () => {
    const small = wilsonInterval(5, 10);
    const large = wilsonInterval(50, 100);
    expect(large.high - large.low).toBeLessThan(small.high - small.low);
  });
});
