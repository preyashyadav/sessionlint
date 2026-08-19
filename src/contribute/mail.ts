/**
 * Opens the user's own mail client with a prefilled draft. Nothing here transmits:
 * `mailto:` hands a draft to whatever app the OS has registered, and a human presses
 * send. There is no SMTP path, no API call, and no attachment — `mailto:` cannot
 * carry one, which is why the body says to attach and the CLI prints the absolute
 * path, copies it to the clipboard, and (on macOS) reveals it in Finder.
 *
 * Every step here is best-effort. The command must remain fully usable when the mail
 * handler does nothing at all, so the caller always prints the manual fallback.
 */

export interface MailDraft {
  to: string;
  subject: string;
  body: string;
}

export function buildMailto(draft: MailDraft): string {
  const q = `subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;
  return `mailto:${encodeURIComponent(draft.to)}?${q}`;
}

export function buildBody(args: {
  handle: string;
  version: string;
  sessionCount: number;
  dateRange: { from: string; to: string } | null;
  filePath: string;
}): string {
  const range = args.dateRange ? `${args.dateRange.from} to ${args.dateRange.to}` : "n/a";
  return [
    `>>> Please attach this file before sending:`,
    `>>> ${args.filePath}`,
    ``,
    `handle:    ${args.handle}`,
    `sessions:  ${args.sessionCount} (${range})`,
    `generated: sessionlint v${args.version}`,
    ``,
    `Redacted with sessionlint export --redact. Edit or delete anything below.`,
    ``,
    `Notes:`,
    ``,
  ].join("\n");
}

/** The platform's "open this URL/file with the default handler" command. */
function openerFor(platform: NodeJS.Platform): string[] | null {
  if (platform === "darwin") return ["open"];
  if (platform === "win32") return ["cmd", "/c", "start", ""];
  if (platform === "linux") return ["xdg-open"];
  return null;
}

export interface OpenResult {
  mailClientOpened: boolean;
  revealedInFinder: boolean;
  copiedToClipboard: boolean;
}

async function tryRun(cmd: string[]): Promise<boolean> {
  try {
    const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore", stdin: "ignore" });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

async function copyToClipboard(text: string, platform: NodeJS.Platform): Promise<boolean> {
  const cmd = platform === "darwin" ? ["pbcopy"]
    : platform === "win32" ? ["clip"]
    : ["xclip", "-selection", "clipboard"];
  try {
    const proc = Bun.spawn(cmd, { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
    proc.stdin.write(text);
    await proc.stdin.end();
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

export async function openDraft(
  draft: MailDraft,
  filePath: string,
  platform: NodeJS.Platform = process.platform
): Promise<OpenResult> {
  const result: OpenResult = { mailClientOpened: false, revealedInFinder: false, copiedToClipboard: false };

  result.copiedToClipboard = await copyToClipboard(filePath, platform);

  const opener = openerFor(platform);
  if (opener) result.mailClientOpened = await tryRun([...opener, buildMailto(draft)]);

  // Reveal the file so it can be dragged straight into the draft.
  if (platform === "darwin") result.revealedInFinder = await tryRun(["open", "-R", filePath]);

  return result;
}
