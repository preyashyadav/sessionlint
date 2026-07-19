/**
 * Vendored pricing table (C-2). Base input/output rates per model, retrieved
 * from platform.claude.com/docs/en/pricing.md on the date below. Cache
 * write/read rates are DERIVED from these base rates via documented
 * multipliers (see rates.ts) — never hardcoded separately, so there is one
 * source of truth per model.
 *
 * `effectiveUntil` marks a known-expiring introductory rate (e.g. Sonnet 5's
 * launch pricing) so the engine can flag stale intro-rate assumptions
 * distinctly from general table staleness (D-004: never claim precision we
 * can't source).
 */

export interface ModelRate {
  inputPerMTok: number;
  outputPerMTok: number;
  effectiveUntil?: string; // ISO date — set only for a known-expiring intro rate
}

export interface PricingTable {
  retrievedAt: string; // ISO date
  sourceUrl: string;
  models: Record<string, ModelRate>;
}

export const PRICING_TABLE: PricingTable = {
  retrievedAt: "2026-07-10",
  sourceUrl: "https://platform.claude.com/docs/en/pricing.md",
  models: {
    "claude-opus-4-8": { inputPerMTok: 5.0, outputPerMTok: 25.0 },
    "claude-opus-4-7": { inputPerMTok: 5.0, outputPerMTok: 25.0 },
    "claude-opus-4-6": { inputPerMTok: 5.0, outputPerMTok: 25.0 },
    // Introductory pricing through 2026-08-31; standard rate is $3/$15.
    "claude-sonnet-5": { inputPerMTok: 2.0, outputPerMTok: 10.0, effectiveUntil: "2026-08-31" },
    "claude-sonnet-4-6": { inputPerMTok: 3.0, outputPerMTok: 15.0 },
    "claude-fable-5": { inputPerMTok: 10.0, outputPerMTok: 50.0 },
    "claude-mythos-5": { inputPerMTok: 10.0, outputPerMTok: 50.0 },
    "claude-haiku-4-5": { inputPerMTok: 1.0, outputPerMTok: 5.0 },
  },
};
