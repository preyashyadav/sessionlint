export interface TurnCostBreakdown {
  turnId: string;
  model: string | null;
  /** false when the turn's model isn't in the pricing table (unknown/future model) — cost fields are 0, not a guess. */
  pricingKnown: boolean;
  inputCost: number;
  cacheWriteCost: number;
  cacheReadCost: number;
  outputCost: number;
  totalCost: number;
  /** true when cache_creation lacked the 5m/1h split and cost fell back to all-5m-rate. */
  cacheBreakdownAssumed: boolean;
  /** true when any response in this turn billed at the model's fast-mode rate (2x base). */
  fastMode: boolean;
  /** true when any response in this turn billed the 1.1x US data-residency premium. */
  inferenceGeoUs: boolean;
}

export interface SessionCostSummary {
  sessionId: string;
  totalCost: number;
  perTurn: TurnCostBreakdown[];
  turnsWithUnknownPricing: number;
  pricingStale: boolean;
  /** Turns billed at fast-mode rates — surfaced so a doubled bill is never unexplained. */
  fastModeTurns: number;
  /** Turns billed with the US data-residency premium. */
  inferenceGeoUsTurns: number;
}
