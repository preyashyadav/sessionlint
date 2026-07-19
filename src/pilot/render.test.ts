import { describe, expect, test } from "bun:test";
import { renderGauge } from "./render";

// D-004 gate test: no point-estimate countdown ("wall in ~60min") anywhere in
// rendered output — only ranges ("wall in ~55-80min") or an explicit "steady".
const POINT_ESTIMATE_COUNTDOWN = /wall in ~?\d+min\b/;
const RANGE_COUNTDOWN = /wall in ~\d+-\d+min\b/;

describe("renderGauge", () => {
  test("with a forecast band, output matches the range pattern and never the point pattern", () => {
    const output = renderGauge(42, { lowMinutes: 55, highMinutes: 80 });
    expect(output).toMatch(RANGE_COUNTDOWN);
    expect(output).not.toMatch(POINT_ESTIMATE_COUNTDOWN);
  });

  test("null band (steady / no wall) never claims a countdown at all", () => {
    const output = renderGauge(10, null);
    expect(output).not.toMatch(POINT_ESTIMATE_COUNTDOWN);
    expect(output).not.toContain("wall in");
    expect(output).toContain("steady");
  });

  test("used percentage is rounded and included", () => {
    expect(renderGauge(41.6, null)).toContain("42%");
  });
});
