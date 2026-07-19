import { describe, expect, test } from "bun:test";
import { formatCostRange, formatCostRangeShort, formatUsdRangeOuter } from "./format";

/** D-008 P0: display rounding must never collapse a real range back into a point —
 * found running against real data, where a 2-token cache-nuke rendered "$0.00–$0.00"
 * and its session line rendered "~$19.38–$19.38". */
describe("range formatters never display a point", () => {
  test("formatCostRangeShort: normal range is unchanged", () => {
    expect(formatCostRangeShort({ low: 0.43, high: 3.15 })).toBe("$0.43–$3.15");
  });

  test("formatCostRangeShort: sub-cent range renders as <$0.01, not $0.00–$0.00", () => {
    expect(formatCostRangeShort({ low: -0.00001, high: 0.000008 })).toBe("<$0.01");
  });

  test("formatCostRangeShort: endpoints rounding to the same cent are outer-bounded apart", () => {
    expect(formatCostRangeShort({ low: 1.231, high: 1.234 })).toBe("$1.23–$1.24");
  });

  test("formatCostRangeShort: negative low keeps its sign (net-save cache-nuke)", () => {
    expect(formatCostRangeShort({ low: -0.03, high: 0.01 })).toBe("-$0.03–$0.01");
  });

  test("formatCostRangeShort: absent costImpact renders the em-dash placeholder", () => {
    expect(formatCostRangeShort(undefined)).toBe("—");
  });

  test("formatUsdRangeOuter: same-cent session range is outer-bounded, never a point", () => {
    expect(formatUsdRangeOuter(19.379992, 19.38001)).toBe("$19.37–$19.39");
  });

  test("formatUsdRangeOuter: normal range is unchanged", () => {
    expect(formatUsdRangeOuter(216.399, 219.133)).toBe("$216.40–$219.13");
  });

  test("formatCostRange (verbose): sub-cent range renders as prose, same-cent outer-bounds", () => {
    expect(formatCostRange({ low: -0.00001, high: 0.000008 })).toBe("less than $0.01");
    expect(formatCostRange({ low: 1.231, high: 1.234 })).toBe("+$1.23 to +$1.24");
    expect(formatCostRange({ low: -0.0255, high: 0.01275 })).toBe("-$0.03 to +$0.01");
  });
});
