/** Parse a command flag into argv without invoking a shell.
 *
 * Quotes and backslash escaping are supported so paths/arguments can contain spaces.
 * Shell operators are rejected when unquoted: accepting them as ordinary argv was a
 * silent correctness bug, while evaluating them would expand the command-injection
 * surface. Callers that need a shell must explicitly pass `sh -c "..."` as argv.
 */
export function parseCommandArgv(raw: string, flagName: string): string[] {
  const argv: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let tokenStarted = false;

  const push = () => {
    if (!tokenStarted) return;
    argv.push(current);
    current = "";
    tokenStarted = false;
  };

  for (let i = 0; i < raw.length; i++) {
    const char = raw[i]!;
    if (escaped) {
      current += char;
      tokenStarted = true;
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      tokenStarted = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      tokenStarted = true;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      tokenStarted = true;
      continue;
    }
    if (/\s/.test(char)) {
      push();
      continue;
    }
    if ("&|;<>`".includes(char) || (char === "$" && raw[i + 1] === "(")) {
      throw new Error(
        `${flagName} uses argv syntax and does not invoke a shell; ` +
          `shell operators are not accepted. Pass an explicit executable and arguments ` +
          `(or explicitly use sh -c if shell behavior is intentional).`
      );
    }
    current += char;
    tokenStarted = true;
  }

  if (escaped) throw new Error(`${flagName} ends with an incomplete escape.`);
  if (quote) throw new Error(`${flagName} contains an unclosed ${quote} quote.`);
  push();
  if (argv.length === 0) throw new Error(`${flagName} must contain a command.`);
  return argv;
}
