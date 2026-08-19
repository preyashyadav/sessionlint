# Contribute your session history

Every number in sessionlint currently comes from **one machine**. The lint rules are
heuristics until someone measures how often they're right on real, varied sessions,
and the cost ledger has only ever been reconciled against headless runs.

You can fix both by sending a redacted copy of your history. Steps 1–3 below are just
"run the tool and look at your own report" — do those even if you never send anything.

---

## 1. Install

```bash
curl -fsSL https://bun.com/install | bash && bunx sessionlint
```

sessionlint runs on [Bun](https://bun.com), not Node. The first half of that line
installs Bun if you don't already have it. `npx sessionlint` will **not** work.

## 2. Check it found your sessions

```bash
bunx sessionlint doctor
```

You should see a sessions root, a count, and a pricing-table age. If you run more than
one Claude account, doctor lists **every** config dir it found and marks which ones are
being read:

```
  config roots found  3
    ✓ scanned     .claude-account-b        7 transcript(s)
    ✗ NOT scanned .claude                  15 transcript(s)
    ✗ NOT scanned .claude-account-tago     11 transcript(s)
```

If it says zero sessions, your `CLAUDE_CONFIG_DIR` probably points somewhere else —
doctor prints where it looked.

## 3. Look at your own report first

```bash
bunx sessionlint
```

This is read-only and touches nothing. Add `--all-roots` to include every config dir.

Findings come with a dollar **range** and the assumptions behind it spelled out, because
none of this is precise enough to deserve a point estimate. If it prints nothing, that's
a real answer too — and a useful one for the study.

---

*Steps 1–3 are the whole "try it" path. Everything below is the contribution part.*

---

## 4. Optional: capture the statusline (one week)

This is the highest-value thing you can contribute, and it costs you nothing but a
config line. Claude Code hands its **own** cost accounting to the statusline command on
every render. Comparing that against a ledger rebuilt from the transcript is the only
way to check whether transcript-derived costs are trustworthy on the interactive path.

Add to your settings file (`~/.claude/settings.json`, or
`$CLAUDE_CONFIG_DIR/settings.json`):

```json
"statusLine": {
  "type": "command",
  "command": "bun run <path-to>/scripts/experiment/capture-statusline.ts"
}
```

Your statusline becomes `Opus 5 · ctx 20% · $1.23 · 5h 3%`. Delete the `statusLine` key
to stop it.

**What it logs:** an explicit allowlist of accounting fields only — model id, cost
totals, context-window token counts, rate-limit percentages, Claude Code version. It
logs **no** prompt text, file paths, tool arguments, repo names, or session names. The
allowlist is a table at the top of the script; read it, it's short.

Then work normally for a week and run:

```bash
bun run scripts/experiment/reconcile.ts
```

## 5. Send it

```bash
bunx sessionlint send2preyash
```

Three steps: confirm, review the preview, attach and send.

- You'll be asked for a **handle** (a nickname, not an email). It's never derived from
  your username, git config, or email address.
- You get a full preview before any file is written: session list, totals, the exact
  field list, and **one real redacted line from your own data** so you can see the shape
  of what leaves.
- It writes **one file** to your current directory and opens a draft in your mail
  client. **You attach the file and press send.** sessionlint has no ability to send it.
- Add `--include-reconciliation` to fold in the statusline data from step 4.
- Useful flags: `--last 10`, `--since 2026-08-01`, `--session <id>`, `--to <address>`.

If the mail draft doesn't open, the command prints the recipient, subject, and file path
as plain copyable text. It works fine without any of the automation.

---

## Privacy, in plain English

**What is stripped.** Prose and message content (replaced with lorem ipsum of similar
length), file contents, absolute and relative paths, filenames, secret-shaped tokens,
free-text object keys, git branch names, MCP server names, project directory names, and
session UUIDs. Project directories are path-encoded working directories and routinely
contain employer, client, and unreleased product names — they become `project-a`,
`project-b`, and the mapping stays in a local file on **your** machine, never in the
bundle.

**What is kept.** Model names, timestamps, token counts, tool names, turn structure, and
cost figures. That's what the rules and the cost math need, and it's the whole point of
the exercise.

**What I do with it.** Measure how often each lint rule fires correctly on real
sessions, and whether the cost ledger matches Claude Code's own accounting. Results get
published — including negative ones. Your bundle itself is never republished, quoted, or
shared.

**Redaction is best-effort, not a guarantee.** An automated redactor cannot prove the
absence of every possible secret shape. The bundle is one plain JSON file specifically
so you can open it and look before you send. Please do.

**Withdrawing.** Email me and I delete it. No account to close, nothing to log into —
there's nothing to withdraw from except a file in my inbox.

**Nothing is ever transmitted automatically.** There is no upload path in this codebase.
`--paranoid` refuses the contribution command outright.
