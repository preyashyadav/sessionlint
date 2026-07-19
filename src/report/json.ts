import type { Report } from "./types";

/**
 * Machine-readable export for CI (C-4). Preserves the full cost-impact range per finding (D-004).
 *
 * The output is versioned via a top-level `schemaVersion`. Policy: additive changes bump the
 * minor, breaking changes bump the major (one-major deprecation window). See docs/json-schema.md.
 */
export const JSON_SCHEMA_VERSION = "1.0.0";

export function renderJson(report: Report): string {
  return JSON.stringify({ schemaVersion: JSON_SCHEMA_VERSION, ...report }, null, 2);
}
