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
}

export interface SessionCostSummary {
  sessionId: string;
  totalCost: number;
  perTurn: TurnCostBreakdown[];
  turnsWithUnknownPricing: number;
  pricingStale: boolean;
}
