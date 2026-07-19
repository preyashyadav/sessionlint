/**
 * Tier 1 generic webhook: one POST with the finding as JSON. Deliberately
 * service-agnostic (ntfy/Pushover/Slack-compatible endpoints all accept a
 * plain POST target) — sessionlint bundles no notification service (D-008 P1
 * spec: "support a generic POST... do not bundle any service").
 */

import type { WatchFinding } from "./watch-runner";

export async function realWebhookPost(url: string, payload: WatchFinding): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "sessionlint watch",
        reason: payload.reason,
        detail: payload.detail,
        sessionId: payload.sessionId,
        at: new Date(payload.atMs).toISOString(),
      }),
    });
    return response.ok;
  } catch {
    return false; // notification failure must never take down the watcher
  }
}
