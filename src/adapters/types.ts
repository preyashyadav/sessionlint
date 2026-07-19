/**
 * Shared capability-detection vocabulary for all log adapters (C-1).
 * An adapter never crashes on an unrecognized format — it reports a named,
 * typed gap here instead.
 */

export type CapabilityId =
  | "content-text"
  | "model-recoverable"
  | "tool-call-recoverable"
  | "tool-result-recoverable"
  | "usage-fields"
  | "turn-grouping"
  | "version-known"
  | "entry-type-known";

export interface CapabilityGap {
  capability: CapabilityId;
  severity: "info" | "degraded" | "missing";
  reason: string;
  detail?: string;
}

export interface CapabilityReport {
  ccVersion: string | null;
  supported: CapabilityId[];
  gaps: CapabilityGap[];
}
