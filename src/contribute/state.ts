/**
 * Local contributor state: the handle, and the project-name pseudonym map.
 *
 * Both are deliberately LOCAL-ONLY. The handle is asked for, never derived from
 * $USER / git config / email — deriving it would be silent PII collection, which is
 * exactly what this whole flow exists to avoid. The pseudonym map stays on the
 * contributor's machine so THEY can decode `project-a` in a later conversation while
 * the bundle itself carries nothing decodable.
 */

import { mkdir, readFile, writeFile } from "fs/promises";
import { homedir } from "os";
import { dirname, join } from "path";

export interface ContribState {
  handle?: string;
  /** real project-dir name -> stable pseudonym ("project-a"). Never leaves this file. */
  projectMap?: Record<string, string>;
}

export function statePath(): string {
  return join(homedir(), ".sessionlint", "contrib-state.json");
}

export async function readState(path: string = statePath()): Promise<ContribState> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as ContribState;
  } catch {
    return {};
  }
}

export async function writeState(state: ContribState, path: string = statePath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2) + "\n", "utf8");
}

/** Excel-style pseudonyms so a heavy user doesn't collide: a..z, then aa, ab, ... */
export function pseudonymFor(index: number): string {
  let n = index, label = "";
  do {
    label = String.fromCharCode(97 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `project-${label}`;
}

/** Assigns stable pseudonyms to any project names not already mapped. Mutates + returns. */
export function assignPseudonyms(map: Record<string, string>, projectNames: string[]): Record<string, string> {
  const used = new Set(Object.values(map));
  for (const name of projectNames) {
    if (map[name]) continue;
    let i = 0;
    let candidate = pseudonymFor(i);
    while (used.has(candidate)) candidate = pseudonymFor(++i);
    map[name] = candidate;
    used.add(candidate);
  }
  return map;
}

/** A handle we're willing to put in a subject line: short, printable, no PII shapes. */
export function validateHandle(raw: string): { ok: true; handle: string } | { ok: false; reason: string } {
  const handle = raw.trim();
  if (handle.length < 2) return { ok: false, reason: "too short (2+ characters)" };
  if (handle.length > 32) return { ok: false, reason: "too long (32 characters max)" };
  if (handle.includes("@")) return { ok: false, reason: "looks like an email address — use a nickname, not an address" };
  if (!/^[A-Za-z0-9 _-]+$/.test(handle)) return { ok: false, reason: "use letters, digits, spaces, hyphens, or underscores only" };
  return { ok: true, handle };
}
