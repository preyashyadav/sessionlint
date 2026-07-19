/**
 * Defensive parser for the statusLine JSON schema (C-1 style: unknown/missing
 * fields degrade to undefined, never throw). `fast_mode` and other undocumented
 * fields observed live (docs/usage-surfaces.md) are simply ignored here — this
 * parser only extracts what PILOT needs.
 *
 * rate_limits and cost/session_id are parsed independently, not as an
 * all-or-nothing block: metered/API-key users (Task 5's credits sentinel
 * audience) are exactly the population docs/usage-surfaces.md says has NO
 * rate_limits at all, so bailing out early when rate_limits is absent would
 * silently break the credits sentinel for its actual target users.
 */

import type { StatusLineInput, StatusLineRateWindow } from "./types";

export function parseStatusLineInput(raw: unknown): StatusLineInput {
  if (typeof raw !== "object" || raw === null) return {};
  const obj = raw as Record<string, unknown>;
  const result: StatusLineInput = {};

  const rateLimitsRaw = obj["rate_limits"];
  if (typeof rateLimitsRaw === "object" && rateLimitsRaw !== null) {
    const rateLimitsObj = rateLimitsRaw as Record<string, unknown>;
    const fiveHour = parseWindow(rateLimitsObj["five_hour"]);
    const sevenDay = parseWindow(rateLimitsObj["seven_day"]);
    if (fiveHour || sevenDay) result.rateLimits = { fiveHour, sevenDay };
  }

  if (typeof obj["session_id"] === "string") result.sessionId = obj["session_id"];

  const costRaw = obj["cost"];
  if (typeof costRaw === "object" && costRaw !== null) {
    const totalCostUsd = (costRaw as Record<string, unknown>)["total_cost_usd"];
    if (typeof totalCostUsd === "number") result.totalCostUsd = totalCostUsd;
  }

  return result;
}

function parseWindow(raw: unknown): StatusLineRateWindow | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const obj = raw as Record<string, unknown>;
  const usedPercentage = obj["used_percentage"];
  const resetsAt = obj["resets_at"];
  if (typeof usedPercentage !== "number" || typeof resetsAt !== "number") return undefined;
  return { usedPercentage, resetsAt };
}
