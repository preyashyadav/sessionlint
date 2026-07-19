/**
 * Transcript redactor for `sessionlint export --redact`. Default-deny: a string
 * survives verbatim only if it looks like a short identifier/enum/timestamp/uuid
 * token. Everything else — prose, paths, filenames, secret-shaped tokens, and
 * object KEYS (some tool payloads key a map by free-text) — is replaced with a
 * synthetic placeholder. Model names, tool names, timestamps, entry/block types,
 * and usage token counts are preserved exactly, so the redacted transcript is
 * still analyzable by the rules and cost engine.
 *
 * ⚠ Best-effort, not a guarantee. Automated redaction cannot prove the absence of
 * every possible secret shape — output MUST be reviewed before it is shared.
 *
 * Ported from the fixture sanitizer, including its documented fixes: object keys
 * get the same default-deny treatment as values (a values-only pass leaked prose
 * keys), and a path leaf keeps a suffix only when it matches a KNOWN file
 * extension (so a dotted directory name can't leak its trailing text).
 */

const IDENTIFIER_RE = /^[A-Za-z0-9_.:+-]{1,48}$/;

export const SECRET_RE =
  /(sk-(ant-)?[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]+-----|Bearer\s+[A-Za-z0-9._-]{16,})/i;

const FILE_EXT_RE =
  /\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|cpp|h|hpp|md|mdx|json|jsonl|yaml|yml|toml|txt|png|jpe?g|gif|svg|webp|pdf|csv|tsv|html?|css|scss|sql|sh|bash|zsh|env|lock|log)$/i;

/** Keys whose values are known-safe enum/mime tokens that legitimately contain
 * characters IDENTIFIER_RE rejects (e.g. "image/png"). */
const KEEP_VERBATIM_KEYS = new Set(["media_type", "mimeType", "mime_type"]);

function looksLikePath(v: string): boolean {
  return (v.startsWith("/") || v.startsWith("~/")) && v.length > 1 && !v.includes(" ");
}

function looksLikeBareFilename(v: string): boolean {
  return !v.includes(" ") && !v.includes("/") && v.length <= 100 && FILE_EXT_RE.test(v);
}

const FILLER_WORDS = [
  "lorem", "ipsum", "dolor", "sit", "amet", "consectetur", "adipiscing", "elit",
  "sed", "do", "eiusmod", "tempor", "incididunt", "ut", "labore", "et", "dolore", "magna",
];

function fillerText(length: number): string {
  if (length <= 0) return "";
  const bucketed = Math.min(2000, Math.ceil(length / 40) * 40);
  const words: string[] = [];
  let total = 0;
  let i = 0;
  while (total < bucketed) {
    const w = FILLER_WORDS[i % FILLER_WORDS.length]!;
    words.push(w);
    total += w.length + 1;
    i++;
  }
  return words.join(" ").slice(0, bucketed);
}

export interface Sanitizer {
  sanitizeLine(line: string): string;
  sanitizeJsonl(raw: string): string;
}

/** Each sanitizer instance owns its own memo state, so the same real value maps to
 * the same placeholder within one export and object-map keys never collide, without
 * any cross-invocation shared global state. */
export function createSanitizer(): Sanitizer {
  const pathMemo = new Map<string, string>();
  let pathCounter = 0;
  const filenameMemo = new Map<string, string>();
  let filenameCounter = 0;
  const keyMemo = new Map<string, string>();
  let keyCounter = 0;

  function sanitizePath(p: string): string {
    const memoized = pathMemo.get(p);
    if (memoized) return memoized;
    const leadingSlash = p.startsWith("/") ? "/" : "";
    const parts = p.replace(/^~?\//, "").split("/").filter(Boolean);
    const n = pathCounter++;
    const last = parts[parts.length - 1] ?? "";
    const extMatch = last.match(FILE_EXT_RE);
    const ext = extMatch ? extMatch[0] : "";
    const dirDepth = Math.max(0, parts.length - 1);
    const dirs = Array.from({ length: dirDepth }, (_, i) => `dir_${n}_${i}`);
    const leaf = ext ? `file_${n}${ext}` : `dir_${n}_leaf`;
    const result = leadingSlash + [...dirs, leaf].join("/");
    pathMemo.set(p, result);
    return result;
  }

  function sanitizeBareFilename(v: string): string {
    const memoized = filenameMemo.get(v);
    if (memoized) return memoized;
    const dotIdx = v.lastIndexOf(".");
    const ext = v.slice(dotIdx);
    const result = `file_${filenameCounter++}${ext}`;
    filenameMemo.set(v, result);
    return result;
  }

  function sanitizeString(key: string | null, value: string): string {
    if (key === "gitBranch") return "main";
    if (key && KEEP_VERBATIM_KEYS.has(key)) return value;
    if (SECRET_RE.test(value)) return fillerText(value.length);
    if (looksLikePath(value)) return sanitizePath(value);
    if (looksLikeBareFilename(value)) return sanitizeBareFilename(value);
    if (IDENTIFIER_RE.test(value)) return value;
    return fillerText(value.length);
  }

  function sanitizeKey(k: string): string {
    if (looksLikePath(k)) return sanitizePath(k);
    if (looksLikeBareFilename(k)) return sanitizeBareFilename(k);
    if (SECRET_RE.test(k)) {
      const placeholder = `key_${keyCounter++}`;
      keyMemo.set(k, placeholder);
      return placeholder;
    }
    if (IDENTIFIER_RE.test(k)) return k;
    const memoized = keyMemo.get(k);
    if (memoized) return memoized;
    const placeholder = `key_${keyCounter++}`;
    keyMemo.set(k, placeholder);
    return placeholder;
  }

  function sanitizeValue(key: string | null, value: unknown): unknown {
    if (value === null || typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "string") return sanitizeString(key, value);
    if (Array.isArray(value)) return value.map((v) => sanitizeValue(key, v));
    if (typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[sanitizeKey(k)] = sanitizeValue(k, v);
      }
      return out;
    }
    return value;
  }

  return {
    sanitizeLine(line: string): string {
      return JSON.stringify(sanitizeValue(null, JSON.parse(line)));
    },
    sanitizeJsonl(raw: string): string {
      return (
        raw
          .split("\n")
          .filter((l) => l.trim())
          .map((l) => JSON.stringify(sanitizeValue(null, JSON.parse(l))))
          .join("\n") + "\n"
      );
    },
  };
}
