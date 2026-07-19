import type { Report } from "./types";

/** Machine-readable export for CI (C-4). Preserves the full cost-impact range per finding (D-004). */
export function renderJson(report: Report): string {
  return JSON.stringify(report, null, 2);
}
