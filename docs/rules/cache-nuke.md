# cache-nuke

**Fresh-input processing after a mid-session model switch**

## What it detects

Fires when a session switches models mid-conversation and the next call reports fresh input. The token count is directly observed. Attribution is conditional: if the idle gap exceeds the default five-minute cache TTL, the cache may have expired without the switch, so the finding is informational and assigns no avoidable cost.

## Why it costs you

Within a warm-cache window, a model switch can prevent reuse of the old model's cache. Outside that window, the rule reports the observed fresh input without claiming cause.

## How to fix it

Pick the model before the context grows, or make the switch at a natural boundary after /clear or /compact so there is little context to reprocess. If you switch to a CHEAPER model, the finding's range can show a net save — the report says so rather than pretending every switch is waste.

## How the $ range is computed

Within the default TTL, the range spans two labeled assumptions: high assumes the cache would have remained readable; low assumes the content might not have been cached anyway. After the TTL, no avoidable-cost range is attributed to the switch. Switches that reprocessed fewer than 1,024 fresh input tokens (the smallest cacheable prefix on any current model) do not fire at all — the cache was plainly still warm and there is nothing to report.

---

*Generated from `src/report/rule-docs.ts` — edit there, not here. Suppress with `sessionlint --suppress cache-nuke`.*
