/**
 * Generates the settings.json hook config snippet for the wind-down advisor.
 * NOT wired to write to the user's real ~/.claude/settings.json anywhere in
 * this codebase yet — that's a distinct, deliberate install step reserved
 * for when a human explicitly asks for it (D-003: effects are opt-in).
 *
 * Targeting exactly "UserPromptSubmit" here (never a PreToolUse/PostToolUse
 * tool-scoped event) is the structural guarantee that the advisor can only
 * ever fire at a turn boundary, never mid-turn.
 */

export interface HookConfigEntry {
  matcher: string;
  hooks: Array<{ type: "command"; command: string; timeout: number }>;
}

export interface UserPromptSubmitHookConfig {
  hooks: {
    UserPromptSubmit: HookConfigEntry[];
  };
}

export function generateUserPromptSubmitHookConfig(commandPath: string): UserPromptSubmitHookConfig {
  return {
    hooks: {
      UserPromptSubmit: [
        {
          matcher: "",
          hooks: [{ type: "command", command: commandPath, timeout: 5 }],
        },
      ],
    },
  };
}
