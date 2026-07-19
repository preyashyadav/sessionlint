/**
 * PILOT (Phase 3) domain types. Source data is the statusLine JSON Claude Code
 * pipes to a configured statusLine.command's stdin — see docs/usage-surfaces.md
 * for the verified field inventory and gaps vs. the official docs.
 */

export interface StatusLineRateWindow {
  usedPercentage: number;
  /** Unix epoch seconds — exactly as Claude Code emits it. */
  resetsAt: number;
}

export interface StatusLineInput {
  rateLimits?: {
    fiveHour?: StatusLineRateWindow;
    sevenDay?: StatusLineRateWindow;
  };
  sessionId?: string;
  totalCostUsd?: number;
}

export interface BurnSample {
  /** Epoch ms. */
  timestamp: number;
  usedPercentage: number;
}

export interface BurnRateEstimate {
  percentPerMinute: number;
  basis: "recent" | "window-average";
}

export interface ForecastBand {
  lowMinutes: number;
  highMinutes: number;
}
