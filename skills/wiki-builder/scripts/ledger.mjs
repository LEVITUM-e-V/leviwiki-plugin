#!/usr/bin/env node
// Writes the ledger of a wiki migration job (skills/wiki-builder/reference/migrate-ledger.md) so no session edits YAML by hand.
// No LLM, no network, no dependencies: plain Node. It reads the job folder with the same YAML subset as check-ledger.mjs,
// changes one thing in memory, runs the full check on the result and writes only when the change adds no problem.
//
//   node ledger.mjs <job dir> add-units    <input>     append units (ids u001... assigned, counts in state.yaml updated)
//   node ledger.mjs <job dir> add-decision <input>     append a decision of the human (decided_by: user, id and date added)
//   node ledger.mjs <job dir> set-policy   <key> <input> | --na    record an intake answer (policies.<key>)
//   node ledger.mjs <job dir> set-fate     <source id> <input>     set a source's proposal or fate fields in inventory.yaml
//   node ledger.mjs <job dir> add-sweep    <input>     append sweep records (ids sw1... assigned)
//   node ledger.mjs <job dir> upsert-page  <input>     add or update page-store rows in pages.yaml (merged by id or ref)
//   node ledger.mjs <job dir> set-phase    <phase>     move phase; going forward needs a clean check at that phase
//   node ledger.mjs <job dir> note [--next] [--] <text...>  append a session note to state.yaml notes:, or set next: (where to continue)
//   node ledger.mjs <job dir> repair-counts            recompute counts.units and counts.max_unit_id in state.yaml from units.yaml
//
// <input> is `--json '<value>'`, `--yaml '<text>'` (the reader's flow lines), `--file <path>` (JSON or YAML) or `--stdin`.
// Flags count only before a `--` separator (for `note` only as the first argument); after it everything is text, so a note may say "--next".
// A file other than units.yaml is rewritten in a canonical layout (comments are not kept); units.yaml is only appended to.
// A change is refused only for problems it ADDS: a problem that already existed (a count mismatch after an interrupted write, say) does not block it (problems are compared with their numbers normalised, so a count that moved is not new).
// Exit 0: written; 1: refused (the problems the change would add are listed, nothing is written); 2: usage or unreadable ledger.

import { readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PHASES, POLICY_KEYS, POLICY_NA, checkLedger, loadJob, parseYaml } from "./check-ledger.mjs";

/** The inventory fields set-fate may write: the M9 proposal and the executed fate. */
export const FATE_FIELDS = ["disposition", "disposition_reason", "lives_at", "new_path", "breaks", "order", "fate", "fate_link", "fate_reason", "decision", "executed_at", "version_checked", "branch", "pr", "default_branch", "unresolved", "url"];

/**
 * One value as one-line YAML flow text: strings always quoted (JSON), so a number-like or colon-bearing string reads back as a string.
 * @param {unknown} v A string, number, boolean, null, array or plain object.
 * @returns {string}
 */
export function flowText(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `[${v.map(flowText).join(", ")}]`;
  if (typeof v === "object") return `{${Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => `${keyText(k)}: ${flowText(x)}`).join(", ")}}`;
  throw new Error(`cannot write a ${typeof v} as YAML`);
}

/** @param {string} k A map key. @returns {string} The key, quoted when it is not a plain word. */
const keyText = (k) => (/^[A-Za-z_][\w.-]*$/.test(k) ? k : JSON.stringify(k));

/**
 * Writes a map in the ledger's canonical layout: nested maps as blocks, lists of maps one `- {flow}` line per item, everything else on one line.
 * @param {Record<string, unknown>} obj The map.
 * @param {number} [ind] Indentation in spaces.
 * @returns {string[]} Lines.
 */
export function dumpMap(obj, ind = 0) {
  const pad = " ".repeat(ind);
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (Array.isArray(v) && v.length && v.every((x) => x && typeof x === "object" && !Array.isArray(x))) {
      out.push(`${pad}${keyText(k)}:`);
      for (const item of v) out.push(`${pad}  - ${flowText(item)}`);
    } else if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length) {
      out.push(`${pad}${keyText(k)}:`, ...dumpMap(v, ind + 2));
    } else out.push(`${pad}${keyText(k)}: ${flowText(v)}`);
  }
  return out;
}

/**
 * Writes a file atomically (temp file, then rename) and checks that the text reads back as the same value.
 * @param {string} path Target file.
 * @param {string} text New content.
 * @param {unknown} [expect] When given, the value the text must parse to (structure compared as JSON).
 */
function writeChecked(path, text, expect) {
  const back = parseYaml(text);
  if (expect !== undefined && JSON.stringify(back) !== JSON.stringify(JSON.parse(JSON.stringify(expect)))) throw new Error(`${path}: the new text does not read back as the intended value; nothing written`);
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, path);
}

/** @param {string} dir Job folder. @param {string} name File. @param {Record<string, unknown>} value Its map. */
function rewrite(dir, name, value) {
  writeChecked(join(dir, name), `${dumpMap(value).join("\n")}\n`, value);
}

/** @returns {string} Today as YYYY-MM-DD. */
const today = () => new Date().toISOString().slice(0, 10);

/** @param {unknown} v @returns {any[]} `v` when it is a list, else []. */
const list = (v) => (Array.isArray(v) ? v : []);

/**
 * The problems of the whole ledger, for comparing before and after a change.
 * @param {any} job The loaded job.
 * @returns {string[]}
 */
function problemsOf(job) {
  const hashOf = (t) => createHash("sha256").update(t).digest("hex");
  return checkLedger({ state: job.state, plan: job.plan, units: job.units, inventory: job.inventory, sweep: job.sweep, pages: job.pages, extraFiles: job.extraFiles, drafts: job.drafts }, { hashOf }).problems;
}

/**
 * Reads the command's input value from its flags.
 * @param {string[]} args The arguments after the command.
 * @returns {{value: unknown, rest: string[]}} The parsed value (undefined when no input flag) and the other arguments.
 */
export function readInput(args) {
  const rest = [];
  let text;
  let kind = "json";
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json" || a === "--yaml") {
      kind = a.slice(2);
      text = args[++i];
    } else if (a === "--file") {
      text = readFileSync(args[++i], "utf8");
      kind = /^\s*[[{]/.test(text) ? "json" : "yaml";
    } else if (a === "--stdin") text = readFileSync(0, "utf8");
    else rest.push(a);
  }
  if (text === undefined) return { value: undefined, rest };
  try {
    return { value: kind === "json" && /^\s*[[{]/.test(text) ? JSON.parse(text) : parseYaml(text), rest };
  } catch (err) {
    throw new Error(`input: ${err.message}`);
  }
}

/** @param {unknown} v The input. @param {string} key The wrapper key some inputs use ({units: [...]}). @returns {any[]} The items. */
function items(v, key) {
  const x = v && typeof v === "object" && !Array.isArray(v) && key in v ? v[key] : v;
  return Array.isArray(x) ? x : x && typeof x === "object" ? [x] : [];
}

/** The next number after the largest `<prefix><n>` among `ids`. */
function nextNumber(ids, prefix) {
  let max = 0;
  for (const id of ids) {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(String(id ?? ""));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/**
 * Applies one command to the loaded job in memory.
 * @param {any} job The loaded job (parsed files); changed in place.
 * @param {string} cmd The command.
 * @param {string[]} args Its arguments after the input flags were taken out.
 * @param {unknown} input The parsed input value.
 * @param {string[]} flags Boolean flags seen (--na, --next).
 * @returns {{files: string[], appendUnits?: string, summary: string}} The files to write, unit lines to append, and a one-line summary.
 */
export function apply(job, cmd, args, input, flags = []) {
  const state = job.state;
  switch (cmd) {
    case "add-units": {
      const src = new Map(list(job.inventory?.sources).map((s) => [String(s.id), s]));
      const have = list(job.units?.units);
      // the file is the truth: after an interrupted write the counts in state.yaml may be behind, and repair-counts fixes them
      let n = nextNumber(have.map((u) => u.id), "u");
      const made = items(input, "units").map((u) => {
        const row = src.get(String(u.source));
        const rest = { ...u };
        delete rest.id;
        return { id: `u${String(n++).padStart(3, "0")}`, source: rest.source, version: rest.version ?? row?.version, state: rest.state ?? row?.state, ...rest, origin: rest.origin ?? "read", verdict: rest.verdict ?? "pending" };
      });
      if (!made.length) throw new Error("add-units: no units in the input");
      job.units = { units: [...have, ...made] };
      state.counts = { ...(state.counts ?? {}), units: job.units.units.length, max_unit_id: n - 1 };
      return { files: ["state.yaml"], appendUnits: made.map((u) => `  - ${flowText(u)}`).join("\n"), summary: `${made.length} units appended (${made[0].id}..${made.at(-1).id}), counts updated` };
    }
    case "add-decision": {
      const d = items(input, "decisions")[0];
      if (!d || !String(d.text ?? "").trim()) throw new Error("add-decision: the input needs text, the human's own words");
      const rest = { ...d };
      delete rest.id;
      delete rest.decided_by;
      const id = `d${nextNumber(list(state.decisions).map((x) => x?.id), "d")}`;
      state.decisions = [...list(state.decisions), { id, ...rest, decided_by: "user", date: rest.date ?? today() }];
      return { files: ["state.yaml"], summary: `decision ${id} recorded (decided_by: user)` };
    }
    case "set-policy": {
      const key = args[0];
      if (!POLICY_KEYS.includes(key)) throw new Error(`set-policy: the key must be one of ${POLICY_KEYS.join(", ")}`);
      const v = flags.includes("--na") ? POLICY_NA : { ...items(input, "policy")[0], decided_by: "user", date: today() };
      if (typeof v === "object" && !String(v.text ?? "").trim()) throw new Error("set-policy: the input needs text, the human's own words (or use --na)");
      state.policies = { ...(state.policies ?? {}), [key]: v };
      return { files: ["state.yaml"], summary: `policy ${key} recorded` };
    }
    case "set-fate": {
      const row = list(job.inventory?.sources).find((s) => String(s.id) === String(args[0]));
      if (!row) throw new Error(`set-fate: ${args[0] ?? "(no id)"} is not an inventory row`);
      const patch = items(input, "fate")[0] ?? {};
      const bad = Object.keys(patch).filter((k) => !FATE_FIELDS.includes(k));
      if (bad.length) throw new Error(`set-fate: ${bad.join(", ")} is not a proposal or fate field (${FATE_FIELDS.join(", ")})`);
      Object.assign(row, patch);
      return { files: ["inventory.yaml"], summary: `source ${row.id}: ${Object.keys(patch).join(", ")} set` };
    }
    case "add-sweep": {
      const recs = items(input, "sweeps");
      if (!recs.length) throw new Error("add-sweep: no record in the input");
      const have = list(job.sweep?.sweeps);
      let n = nextNumber(have.map((r) => r.id), "sw");
      job.sweep = { sweeps: [...have, ...recs.map((r) => ({ ...r, id: r.id ?? `sw${n++}` }))] };
      return { files: ["sweep.yaml"], summary: `${recs.length} sweep record(s) added` };
    }
    case "upsert-page": {
      const rows = items(input, "pages");
      if (!rows.length) throw new Error("upsert-page: no row in the input");
      const store = list(job.pages?.pages);
      for (const r of rows) {
        const key = r.id != null ? ["id", String(r.id)] : r.ref != null ? ["ref", String(r.ref)] : undefined;
        if (!key) throw new Error("upsert-page: a row needs id (wiki page) or ref (OneDrive file)");
        const old = store.find((x) => x[key[0]] != null && String(x[key[0]]) === key[1]);
        if (!old) {
          store.push({ ...r });
          continue;
        }
        const { compared, seen_by: seen, ...plain } = r;
        Object.assign(old, plain);
        if (compared) old.compared = { ...(old.compared ?? {}), ...compared };
        if (seen) old.seen_by = [...new Set([...list(old.seen_by), ...list(seen)])];
      }
      job.pages = { pages: store };
      return { files: ["pages.yaml"], summary: `${rows.length} page row(s) upserted, ${store.length} in the store` };
    }
    case "repair-counts": {
      const ids = list(job.units?.units).map((u) => /^u(\d+)$/.exec(String(u?.id ?? ""))).filter(Boolean).map((m) => Number(m[1]));
      state.counts = { ...(state.counts ?? {}), units: list(job.units?.units).length, max_unit_id: ids.length ? Math.max(...ids) : 0 };
      return { files: ["state.yaml"], summary: `counts repaired: ${state.counts.units} units, highest u${String(state.counts.max_unit_id).padStart(3, "0")}` };
    }
    case "set-phase": {
      if (!PHASES.includes(args[0])) throw new Error(`set-phase: the phase must be one of ${PHASES.join(", ")}`);
      state.phase = args[0];
      return { files: ["state.yaml"], summary: `phase ${args[0]}` };
    }
    case "note": {
      const text = args.join(" ").trim();
      if (!text) throw new Error("note: no text");
      if (flags.includes("--next")) state.next = text;
      else state.notes = [...list(state.notes), { date: today(), text }];
      return { files: ["state.yaml"], summary: flags.includes("--next") ? "next set" : "note added" };
    }
    default:
      throw new Error(`unknown command "${cmd}"`);
  }
}

/** @param {string} p A problem message. @returns {string} It with every number replaced, to tell a changed count from a new problem. */
const sameProblem = (p) => String(p).replace(/\d+/g, "#");

/**
 * The problems a change adds. Digits are normalised, so a problem that only changed its number ("3 units are still pending") is not new;
 * the normalised forms are counted, so a second problem of the same shape ("pages 5: no title" next to a new "pages 6: no title") is.
 * @param {string[]} before The problems before the change.
 * @param {string[]} after The problems after it.
 * @returns {string[]} The problems in `after` beyond those `before` already had, by normalised form.
 */
export function newProblems(before, after) {
  const budget = new Map();
  for (const p of before) budget.set(sameProblem(p), (budget.get(sameProblem(p)) ?? 0) + 1);
  return after.filter((p) => {
    const k = sameProblem(p);
    const left = budget.get(k) ?? 0;
    if (left > 0) {
      budget.set(k, left - 1);
      return false;
    }
    return true;
  });
}

/** The problems about `counts` in state.yaml: a stale count (an interrupted write) never blocks a change; `repair-counts` fixes it. */
const COUNT_PROBLEM = /^counts: |^state\.yaml: counts\./;

/**
 * Splits a command's arguments into flags and the rest. Flags (`--na`, and `--next` for `note`) count only before a `--` separator, and for `note`
 * only as the very first argument, so a note's text can say "--next"; everything after `--` is positional text.
 * @param {string} cmd The command.
 * @param {string[]} tail The arguments after the command.
 * @returns {{flags: string[], positional: string[]}}
 */
export function splitArgs(cmd, tail) {
  const sep = tail.indexOf("--");
  const head = sep < 0 ? tail : tail.slice(0, sep);
  const after = sep < 0 ? [] : tail.slice(sep + 1);
  if (cmd === "note") {
    const flags = head[0] === "--next" ? ["--next"] : [];
    return { flags, positional: [...(flags.length ? head.slice(1) : head), ...after] };
  }
  const flags = head.filter((a) => a === "--na");
  return { flags, positional: [...head.filter((a) => a !== "--na"), ...after] };
}

/**
 * Runs one ledger command on a job folder.
 * @param {string[]} argv The command line without node and the script: `<job dir> <command> ...`.
 * @returns {number} The exit code.
 */
export function main(argv) {
  const [dirArg, cmd, ...tail] = argv;
  if (!dirArg || !cmd) {
    console.error("usage: ledger.mjs <job dir> <add-units|add-decision|set-policy|set-fate|add-sweep|upsert-page|set-phase|note> ... (see the header of this script)");
    return 2;
  }
  try {
    const { flags, positional } = splitArgs(cmd, tail);
    const { value, rest } = cmd === "note" ? { value: undefined, rest: positional } : readInput(positional);
    const job = loadJob(dirArg);
    const before = problemsOf(job);
    const oldPhase = PHASES.indexOf(String(job.state.phase ?? ""));
    const clone = structuredClone({ ...job, drafts: {} });
    const work = { ...clone, drafts: job.drafts, dir: job.dir, extraFiles: job.extraFiles };
    const out = apply(work, cmd, rest, value, flags);
    const after = problemsOf(work);
    const gate = cmd === "set-phase" && PHASES.indexOf(String(work.state.phase)) > oldPhase ? after : newProblems(before, after).filter((p) => !COUNT_PROBLEM.test(p));
    if (gate.length) {
      for (const p of gate) console.log(`PROBLEM  ${p}`);
      console.log(`${gate.length} problem(s): refused, nothing written`);
      return 1;
    }
    if (out.appendUnits) {
      const path = join(job.dir, "units.yaml");
      const old = existsSync(path) ? readFileSync(path, "utf8") : "units:\n";
      const text = `${old}${old.endsWith("\n") ? "" : "\n"}${out.appendUnits}\n`;
      parseYaml(text);
      writeFileSync(`${path}.tmp-${process.pid}`, text, { mode: 0o600 });
      renameSync(`${path}.tmp-${process.pid}`, path);
    }
    const names = { "state.yaml": work.state, "inventory.yaml": work.inventory, "sweep.yaml": work.sweep, "pages.yaml": work.pages };
    for (const f of out.files) rewrite(job.dir, f, names[f]);
    console.log(`ok: ${out.summary}`);
    return 0;
  } catch (err) {
    console.error(err.message);
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
