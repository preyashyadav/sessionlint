/**
 * The corpus maintainer's contact address, in ONE place so it can be swapped
 * without hunting through the CLI.
 *
 * TODO(preyash): replace with a dedicated alias (e.g. corpus@<domain>) before this
 * gets much reach. A personal address published inside an npm package is scraped —
 * the package is world-readable and this string sits in plain text in the tarball.
 * `--to` already exists so nobody is blocked on that swap.
 */
export const CORPUS_RECIPIENT = "preyash.me@gmail.com";

/** Where the bundle goes. `--to` overrides for anyone running their own corpus study. */
export function resolveRecipient(args: string[]): string {
  const i = args.indexOf("--to");
  const v = i !== -1 ? args[i + 1] : undefined;
  return v && v.includes("@") ? v : CORPUS_RECIPIENT;
}
