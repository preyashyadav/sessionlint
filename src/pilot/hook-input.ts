/**
 * Defensive parser for the common hook input JSON Claude Code pipes to every
 * hook's stdin (session_id, prompt_id, transcript_path, cwd, permission_mode,
 * hook_event_name) — per the documented Hooks reference. Same
 * capability-detection posture as statusline-input.ts: unknown/missing
 * fields degrade, never throw.
 */

export interface HookInput {
  sessionId: string | null;
  cwd: string | null;
  hookEventName: string | null;
}

export function parseHookInput(raw: unknown): HookInput {
  if (typeof raw !== "object" || raw === null) {
    return { sessionId: null, cwd: null, hookEventName: null };
  }
  const obj = raw as Record<string, unknown>;
  return {
    sessionId: typeof obj["session_id"] === "string" ? obj["session_id"] : null,
    cwd: typeof obj["cwd"] === "string" ? obj["cwd"] : null,
    hookEventName: typeof obj["hook_event_name"] === "string" ? obj["hook_event_name"] : null,
  };
}
