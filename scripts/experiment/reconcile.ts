#!/usr/bin/env bun
/**
 * Ledger-reconciliation experiment: the measurement half.
 *
 * Joins the statusline capture log (Claude Code's own `cost.total_cost_usd`)
 * against a ledger rebuilt from the same session's transcript, and reports the
 * delta distribution with the covariates needed to explain it.
 *
 * The dedupe policy is the main confound, so it is measured rather than
 * assumed: every session is priced three ways — keeping the FIRST usage bag
 * per response, the LAST, and the per-field MAX. If the three agree, the
 * policy cannot be the source of any delta, and that is established for THIS
 * corpus rather than argued from the code. If they disagree, the spread is
 * reported per session and the confound is visible before anything is
 * concluded about the transcript format.
 *
 * Prices come from sessionlint's own rate resolver so the comparison is
 * against the shipped pricing table, not a second implementation of it.
 *
 * Usage:  bun run scripts/experiment/reconcile.ts [--json] [--min-samples N]
 */

import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { getModelRate } from "../../src/pricing/rates";

const LOG_PATH = join(homedir(), ".sessionlint", "experiment", "statusline-samples.jsonl");
const PROJECTS_ROOT = process.env.CLAUDE_CONFIG_DIR
  ? join(process.env.CLAUDE_CONFIG_DIR, "projects")
  : join(homedir(), ".claude", "projects");

type Bag = Record<string, any>;
type Policy = "first" | "last" | "max";

/** Per-response bag selection under each dedupe policy. Keys match turns.ts:
 *  message.id preferred, requestId fallback, uuid as last resort. */
function bagsFor(lines: string[], policy: Policy): { bags: Bag[]; models: string[]; groups: number; multi: number; divergent: number } {
  const byKey = new Map<string, { bags: Bag[]; model: string | null }>();
  let order: string[] = [];
  for (const line of lines) {
    if (!line) continue;
    let o: any;
    try { o = JSON.parse(line); } catch { continue; }
    const u = o?.message?.usage;
    if (!u) continue;
    const mid = o?.message?.id, rid = o?.requestId;
    const key = typeof mid === "string" && mid ? "msg:" + mid
              : typeof rid === "string" && rid ? "req:" + rid
              : "uuid:" + o.uuid;
    if (!byKey.has(key)) { byKey.set(key, { bags: [], model: o?.message?.model ?? null }); order.push(key); }
    byKey.get(key)!.bags.push(u);
  }
  const FIELDS = ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"];
  const out: Bag[] = [];
  const models: string[] = [];
  let multi = 0, divergent = 0;
  for (const key of order) {
    const { bags, model } = byKey.get(key)!;
    if (bags.length > 1) {
      multi++;
      const sig = new Set(bags.map((b) => JSON.stringify(FIELDS.map((f) => b[f] ?? 0))));
      if (sig.size > 1) divergent++;
    }
    let chosen: Bag;
    if (policy === "first") chosen = bags[0]!;
    else if (policy === "last") chosen = bags[bags.length - 1]!;
    else {
      // Per-field max, including the nested cache_creation split — an upper bound
      // that is immune to a partial/streaming bag landing in either position.
      chosen = { ...bags[0] };
      for (const f of FIELDS) chosen[f] = Math.max(...bags.map((b) => b[f] ?? 0));
      const cc5 = Math.max(...bags.map((b) => b.cache_creation?.ephemeral_5m_input_tokens ?? 0));
      const cc1 = Math.max(...bags.map((b) => b.cache_creation?.ephemeral_1h_input_tokens ?? 0));
      if (bags.some((b) => b.cache_creation)) chosen.cache_creation = { ephemeral_5m_input_tokens: cc5, ephemeral_1h_input_tokens: cc1 };
    }
    out.push(chosen);
    if (model) models.push(model);
  }
  return { bags: out, models, groups: order.length, multi, divergent };
}

function priceBags(bags: Bag[], models: string[], when: Date): number {
  let total = 0;
  for (let i = 0; i < bags.length; i++) {
    const b = bags[i]!;
    const model = models[i] ?? models[models.length - 1] ?? null;
    if (!model) continue;
    const rate = getModelRate(model, when, undefined as any, { speed: b.speed ?? null, inferenceGeo: b.inference_geo ?? null });
    if (!rate) continue;
    const cc = b.cache_creation;
    const cw5 = cc ? (cc.ephemeral_5m_input_tokens ?? 0) : (b.cache_creation_input_tokens ?? 0);
    const cw1 = cc ? (cc.ephemeral_1h_input_tokens ?? 0) : 0;
    total += ((b.input_tokens ?? 0) / 1e6) * rate.inputPerMTok
           + (cw5 / 1e6) * rate.cacheWrite5mPerMTok
           + (cw1 / 1e6) * rate.cacheWrite1hPerMTok
           + ((b.cache_read_input_tokens ?? 0) / 1e6) * rate.cacheReadPerMTok
           + ((b.output_tokens ?? 0) / 1e6) * rate.outputPerMTok;
  }
  return total;
}

function findTranscript(sessionId: string): string | null {
  if (!existsSync(PROJECTS_ROOT)) return null;
  for (const proj of readdirSync(PROJECTS_ROOT)) {
    const d = join(PROJECTS_ROOT, proj);
    try { if (!statSync(d).isDirectory()) continue; } catch { continue; }
    const f = join(d, sessionId + ".jsonl");
    if (existsSync(f)) return f;
  }
  return null;
}

// ---- load capture log, one row per session (last + max observed statusline cost) ----
if (!existsSync(LOG_PATH)) {
  console.error(`No capture log at ${LOG_PATH}.`);
  console.error(`Enable the statusline capture first — see scripts/experiment/README.md.`);
  process.exit(1);
}
const samples = readFileSync(LOG_PATH, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) as any[];

const bySession = new Map<string, any[]>();
for (const s of samples) {
  if (!s.sessionId) continue;
  if (!bySession.has(s.sessionId)) bySession.set(s.sessionId, []);
  bySession.get(s.sessionId)!.push(s);
}

const minSamples = Number(process.argv[process.argv.indexOf("--min-samples") + 1]) || 1;
const rows: any[] = [];

for (const [sessionId, ss] of bySession) {
  if (ss.length < minSamples) continue;
  const costs = ss.map((s) => s.costTotalUsd).filter((c) => typeof c === "number") as number[];
  if (costs.length === 0) continue;
  const statusLast = costs[costs.length - 1]!;
  const statusMax = Math.max(...costs);
  // Monotonicity across renders is the cumulative-vs-delta test: a cumulative
  // field never decreases within a session; a per-turn delta bounces.
  let decreases = 0;
  for (let i = 1; i < costs.length; i++) if (costs[i]! < costs[i - 1]!) decreases++;

  const file = findTranscript(sessionId);
  if (!file) { rows.push({ sessionId, statusLast, statusMax, samples: ss.length, decreases, transcript: null }); continue; }

  const lines = readFileSync(file, "utf8").split("\n");
  const when = new Date(ss[0].capturedAt ?? Date.now());
  const led: Record<Policy, number> = { first: 0, last: 0, max: 0 };
  let groups = 0, multi = 0, divergent = 0;
  for (const p of ["first", "last", "max"] as Policy[]) {
    const r = bagsFor(lines, p);
    led[p] = priceBags(r.bags, r.models, when);
    groups = r.groups; multi = r.multi; divergent = r.divergent;
  }

  // covariates
  let toolUses = 0, userTurns = 0;
  const models = new Set<string>();
  for (const line of lines) {
    if (!line) continue;
    let o: any; try { o = JSON.parse(line); } catch { continue; }
    if (o.type === "user") userTurns++;
    const c = o?.message?.content;
    if (Array.isArray(c)) for (const b of c) if (b?.type === "tool_use") toolUses++;
    if (o?.message?.usage && o?.message?.model) models.add(o.message.model);
  }
  // Thinking and output MUST be summed over the same deduped bags. Summing thinking
  // per-line against deduped output inflates it by the duplication factor and can
  // push the ratio past 100%, which would look like proof that thinking is billed
  // on top of output rather than inside it. Same denominator, same numerator basis.
  const r0 = bagsFor(lines, "first");
  const outTok = r0.bags.reduce((a, b) => a + (b.output_tokens ?? 0), 0);
  const thinkTok = r0.bags.reduce((a, b) => a + (b.output_tokens_details?.thinking_tokens ?? 0), 0);
  const thinkFieldSeen = r0.bags.filter((b) => b.output_tokens_details !== undefined).length;
  const thinkOverOut = r0.bags.filter((b) => (b.output_tokens_details?.thinking_tokens ?? 0) > (b.output_tokens ?? 0)).length;

  rows.push({
    sessionId, transcript: file.split("/").pop(), samples: ss.length, decreases,
    statusLast, statusMax,
    ledgerFirst: led.first, ledgerLast: led.last, ledgerMax: led.max,
    ratio: led.first > 0 ? statusLast / led.first : null,
    delta: statusLast - led.first,
    policySpread: Math.max(led.first, led.last, led.max) - Math.min(led.first, led.last, led.max),
    responses: groups, multiLineGroups: multi, divergentGroups: divergent,
    userTurns, toolUses, outputTokens: outTok, thinkingTokens: thinkTok, thinkFieldResponses: thinkFieldSeen, thinkExceedsOutput: thinkOverOut,
    thinkingOn: ss.some((s) => s.thinkingEnabled === true),
    fastMode: ss.some((s) => s.fastMode === true),
    models: [...models].join(","),
    ccVersion: ss[ss.length - 1].version ?? null,
  });
}

if (process.argv.includes("--json")) { console.log(JSON.stringify(rows, null, 2)); process.exit(0); }

// ---- report ----
const usable = rows.filter((r) => r.transcript && r.ledgerFirst > 0);
console.log(`\nsessionlint ledger reconciliation — ${samples.length} statusline samples across ${bySession.size} sessions`);
console.log(`usable (transcript found + priced): ${usable.length}\n`);

if (usable.length === 0) {
  console.log("Nothing to reconcile yet. Keep working normally; the capture log fills as you use Claude Code.");
  process.exit(0);
}

const anyDecrease = rows.some((r) => r.decreases > 0);
console.log(`cost.total_cost_usd monotonic within a session: ${anyDecrease ? "NO — it decreased somewhere (not cumulative)" : "YES across every session (consistent with cumulative-to-date)"}`);
const totalDiv = usable.reduce((a, r) => a + r.divergentGroups, 0);
const totalMulti = usable.reduce((a, r) => a + r.multiLineGroups, 0);
console.log(`dedupe confound: ${totalDiv} divergent bags across ${totalMulti} multi-line response groups`);
console.log(`  → first/last/max ledger spread: ${usable.every((r) => r.policySpread < 1e-9) ? "IDENTICAL on every session — policy is not a confound here" : "NON-ZERO — see policySpread column"}\n`);

const pad = (s: any, n: number) => String(s).padStart(n);
console.log("session   samp  statusline    ledger      ratio    delta   resp  tools  think%  models");
for (const r of usable.sort((a, b) => b.statusLast - a.statusLast)) {
  const thinkPct = r.outputTokens > 0 ? (100 * r.thinkingTokens / r.outputTokens).toFixed(1) : "—";
  console.log(
    `${r.sessionId.slice(0, 8)}  ${pad(r.samples, 4)}  ${pad("$" + r.statusLast.toFixed(4), 10)}  ${pad("$" + r.ledgerFirst.toFixed(4), 10)}  ` +
    `${pad(r.ratio.toFixed(3) + "x", 7)}  ${pad("$" + r.delta.toFixed(4), 9)}  ${pad(r.responses, 4)}  ${pad(r.toolUses, 5)}  ${pad(thinkPct, 6)}  ${r.models.replace(/claude-/g, "")}`
  );
}

const ratios = usable.map((r) => r.ratio).sort((a, b) => a - b);
const med = ratios[Math.floor(ratios.length / 2)]!;
const spread = ratios[ratios.length - 1]! / ratios[0]!;
console.log(`\nratio (statusline / ledger): min ${ratios[0]!.toFixed(3)}  median ${med.toFixed(3)}  max ${ratios[ratios.length - 1]!.toFixed(3)}  spread ${spread.toFixed(2)}x`);

// ---- four-outcome classification ----
const NEAR = 0.02; // within 2% counts as agreement
let verdict: string;
if (Math.abs(med - 1) <= NEAR && spread < 1.05) {
  verdict = "A — ledger ≈ statusline. The JSONL path is sound interactively. No wedge here; archive the hypothesis.";
} else if (med < 1 - NEAR) {
  verdict = "D — ledger EXCEEDS statusline. That is over-counting, not under: suspect a dedupe or double-pricing bug. Fix and re-run before reading anything else.";
} else if (spread < 1.15) {
  verdict = `B — ledger under statusline by a roughly CONSTANT ${((med - 1) * 100).toFixed(1)}%. Consistent with a systematic exclusion (thinking tokens, an unlogged call class). Confirm with a billed claude -p run with thinking on.`;
} else {
  verdict = `C — ledger under statusline by a ratio that VARIES ${ratios[0]!.toFixed(2)}x–${ratios[ratios.length - 1]!.toFixed(2)}x. Content-dependent, so no constant can correct it — the strongest result: no transcript-summing tool can be trusted. Check the correlation columns to find what drives it.`;
}
console.log(`\nOUTCOME  ${verdict}`);
if (usable.length < 15) console.log(`\n(n=${usable.length} — thin. Keep the capture running; this needs dozens of naturally varied sessions.)`);
