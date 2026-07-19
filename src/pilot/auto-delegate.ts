import { homedir } from "os";
import { join } from "path";
import { appendAuditEntry } from "./audit-log";
import { disableAutoDelegate, enableAutoDelegate, readAutoDelegateModel } from "./delegate-config";

export function defaultSettingsPath(projectDir: string): string {
  return join(projectDir, ".claude", "settings.local.json");
}

export function defaultAuditLogPath(): string {
  return join(homedir(), ".sessionlint", "audit-log.jsonl");
}

export interface AutoDelegateOptions {
  settingsPath: string;
  auditLogPath?: string;
  now?: () => Date;
}

const NEXT_SESSION_NOTICE =
  "Takes effect on your NEXT Claude Code session start, not this one — a hook/CLI process can't change an already-running session's environment.";

export async function runAutoDelegateOn(model: string, options: AutoDelegateOptions): Promise<string> {
  const auditLogPath = options.auditLogPath ?? defaultAuditLogPath();
  const now = options.now ?? (() => new Date());
  await enableAutoDelegate(options.settingsPath, model);
  await appendAuditEntry(auditLogPath, {
    timestamp: now().toISOString(),
    action: "auto-delegate-enable",
    detail: { model, settingsPath: options.settingsPath },
  });
  return `sessionlint: delegation autopilot enabled (subagents → ${model}). ${NEXT_SESSION_NOTICE} Undo with \`sessionlint auto-delegate off\`.`;
}

export async function runAutoDelegateOff(options: AutoDelegateOptions): Promise<string> {
  const auditLogPath = options.auditLogPath ?? defaultAuditLogPath();
  const now = options.now ?? (() => new Date());
  const previousModel = await readAutoDelegateModel(options.settingsPath);
  await disableAutoDelegate(options.settingsPath);
  await appendAuditEntry(auditLogPath, {
    timestamp: now().toISOString(),
    action: "auto-delegate-disable",
    detail: { previousModel, settingsPath: options.settingsPath },
  });
  return previousModel
    ? `sessionlint: delegation autopilot disabled. ${NEXT_SESSION_NOTICE}`
    : "sessionlint: delegation autopilot was already off — nothing to undo.";
}
