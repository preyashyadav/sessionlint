import type { CostImpactRange } from "../rules/types";

export function severityGlyph(severity: "error" | "warning" | "info"): string {
  if (severity === "error") return "✗";
  if (severity === "warning") return "⚠";
  return "ℹ";
}

export function ruleLabel(ruleId: string): string {
  return ruleId.toUpperCase();
}

function fmtUsd(n: number): string {
  const rounded = Math.abs(n).toFixed(2);
  // A tiny negative value that rounds to 0.00 must not print a misleading sign
  // (found running against real data: "-$0.00" reads as a real negative cost).
  if (rounded === "0.00") return "$0.00";
  return `${n < 0 ? "-" : ""}$${rounded}`;
}

/** Compact range for the terminal finding column (D-008 P0: every output path shows the
 * range, never a representative point). Cent rounding must never collapse a real range
 * back into a displayed point (found running against real data: a 2-token cache-nuke
 * rendered "$0.00–$0.00") — sub-cent ranges render as "<$0.01", and endpoints that round
 * to the same cent are outer-bounded (floor the low, ceil the high) apart. */
export function formatCostRangeShort(costImpact: CostImpactRange | undefined): string {
  if (!costImpact) return "—"; // —
  if (Math.abs(costImpact.low) < 0.005 && Math.abs(costImpact.high) < 0.005) return "<$0.01";
  let low = costImpact.low;
  let high = costImpact.high;
  if (fmtUsd(low) === fmtUsd(high)) {
    low = Math.floor(low * 100) / 100;
    high = Math.ceil(high * 100) / 100;
  }
  return `${fmtUsd(low)}–${fmtUsd(high)}`; // en dash
}

/** Session-level "could plausibly have been" range — same outer-bounding rule as
 * formatCostRangeShort so display rounding never yields "~$19.38–$19.38". */
export function formatUsdRangeOuter(lowIn: number, highIn: number): string {
  let low = lowIn;
  let high = highIn;
  if (low.toFixed(2) === high.toFixed(2)) {
    low = Math.floor(low * 100) / 100;
    high = Math.ceil(high * 100) / 100;
  }
  return `$${low.toFixed(2)}–$${high.toFixed(2)}`;
}

export function formatCostRange(costImpact: CostImpactRange): string {
  if (Math.abs(costImpact.low) < 0.005 && Math.abs(costImpact.high) < 0.005) return "less than $0.01";
  let low = costImpact.low;
  let high = costImpact.high;
  const fmt = (n: number) => `${n >= 0 ? "+" : "-"}$${Math.abs(n).toFixed(2)}`;
  if (fmt(low) === fmt(high)) {
    low = Math.floor(low * 100) / 100;
    high = Math.ceil(high * 100) / 100;
  }
  return `${fmt(low)} to ${fmt(high)}`;
}

export function turnRangeLabel(from: number, to: number): string {
  return from === to ? `turn ${from}` : `turns ${from}–${to}`; // en dash
}

export function wrapText(text: string, width = 68): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > width && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}
