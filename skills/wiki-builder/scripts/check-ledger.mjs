#!/usr/bin/env node
// Invariant check for a wiki migration job (skills/wiki-builder/reference/migrate.md). No LLM,
// no network, no dependencies: plain Node, so it runs from a plugin install.
//
//   node check-ledger.mjs <job dir> [--close] [--final] [--order] [--layers] [--json]
//   node check-ledger.mjs <job dir> --subjects | --conflicts | --units-for <page key> | --hashes | --dispositions
//
// <job dir> is ~/.leviwiki/migrate/<job>/ with state.yaml, plan.yaml, units.yaml,
// inventory.yaml, sweep.yaml (the searches of Step M3b), pages.yaml (the page store: what the job knows about each wiki page and
// OneDrive file it looked at) and drafts/<plan key>.md. Any other file is a warning (session notes go in state.yaml notes: / next:). Exit 0: nothing wrong; 1: problems
// (listed, one per line); 2: the files can't be read or the call is wrong.
//
//   --close   also demands that nothing is pending, every source has a fate,
//             every page is published and every question answered
//   --final   also fails a `ledger:<key>` link in a draft (the link pass is done)
//   --order   prints the publish order (pages without links to other new pages first)
//   --layers  prints the changesets of a job: the pages in publish order, grouped within the gateway's limits (40 ops, 25 creates, 1.2 million characters), and the pages in a cycle with their link-fixup changeset
//   --json    prints the report as JSON
//   --subjects     every subject with its units (the lead normalises subjects from this, not from units.yaml)
//   --conflicts    only the subjects whose live units differ, with both texts and sources (a wiki source with its revision and last-reviewed)
//   --dispositions the source restructuring proposal (Step M9): one row per source with its eligibility; exit 1 when a row is refused
//   --units-for K  the units of page K plus the known-excluded list, formatted for the coverage agent
//   --hashes       sha256 of each draft, for state.verified
//   --known        the page ids already triaged-out or digested (the `known` list of sweep_wiki), as JSON
//
// From phase verify on (warnings before) it also compares each draft's level-2 headings with the plan page's `template` list, the
// page type with the kinds of the units placed on it, and the Areas that get new pages with their overview page (state.overview).
//
// The ledger files use a small YAML subset (see parseYaml). The pure functions
// are exported for the unit tests (kept in the private repository).

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The phases of a job, in order. A few checks only bite from `draft` on. */
export const PHASES = ["scope", "inventory", "decompose", "sweep", "plan", "reconcile", "draft", "verify", "publish", "close"];

/** Verdicts a unit can carry. `pending` is the one not decided yet. */
export const UNIT_VERDICTS = ["keep", "merge", "link-only", "drop", "out-of-scope", "secret", "pending"];

/** Verdicts of a source item in the inventory. `decomposed` means its units are in units.yaml. */
export const SOURCE_VERDICTS = ["decomposed", "empty", "duplicate", "irrelevant", "blocked", "pending"];

export const UNIT_KINDS = ["method", "data", "decision", "procedure", "changelog", "secret", "todo", "risk"];

// ---------------------------------------------------------------- YAML subset

/**
 * Parses a scalar or a one-line flow collection: "text", 'text', plain text, numbers, true/false/null, [a, b], {k: v}.
 * @param {string} src The text of the value, comment removed.
 * @param {number} line The line number, for errors.
 * @returns {unknown}
 */
function parseValue(src, line) {
  const s = src.trim();
  if (s === "" || s === "~" || s === "null") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^-?\d+$/.test(s) && !/^-?0\d/.test(s)) return Number(s);
  if (/^-?\d+\.\d+$/.test(s) && !/^-?0\d/.test(s)) return Number(s);
  if (s[0] === "[" || s[0] === "{") {
    const p = { s, i: 0, line };
    const v = flow(p);
    skipWs(p);
    if (p.i !== s.length) throw new Error(`line ${line}: unexpected text after the flow value`);
    return v;
  }
  if (s[0] === '"') {
    try {
      return JSON.parse(s);
    } catch {
      throw new Error(`line ${line}: bad double-quoted string (one line, JSON escapes)`);
    }
  }
  if (s[0] === "'") {
    if (!/^'(?:[^']|'')*'$/.test(s)) throw new Error(`line ${line}: bad single-quoted string`);
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (/^[|>&*!]/.test(s)) throw new Error(`line ${line}: block scalars, anchors and tags are not supported; use a quoted one-line string`);
  return s;
}

/** Skips spaces in a flow parser state. */
function skipWs(p) {
  while (p.s[p.i] === " ") p.i++;
}

/**
 * Parses one flow value ([...], {...}, quoted or plain scalar) at p.i.
 * @param {{s: string, i: number, line: number}} p The parser state.
 * @returns {unknown}
 */
function flow(p) {
  skipWs(p);
  const c = p.s[p.i];
  if (c === "[" || c === "{") {
    const close = c === "[" ? "]" : "}";
    p.i++;
    const out = c === "[" ? [] : {};
    skipWs(p);
    if (p.s[p.i] === close) {
      p.i++;
      return out;
    }
    for (;;) {
      if (c === "[") {
        out.push(flow(p));
      } else {
        skipWs(p);
        const key = readKey(p);
        const val = flow(p);
        out[key] = val;
      }
      skipWs(p);
      if (p.s[p.i] === ",") {
        p.i++;
        continue;
      }
      if (p.s[p.i] === close) {
        p.i++;
        return out;
      }
      throw new Error(`line ${p.line}: expected "," or "${close}" in a flow value`);
    }
  }
  if (c === '"' || c === "'") {
    let j = p.i + 1;
    while (j < p.s.length) {
      if (c === '"' && p.s[j] === "\\") j += 2;
      else if (p.s[j] === c) {
        if (c === "'" && p.s[j + 1] === "'") j += 2;
        else break;
      } else j++;
    }
    const raw = p.s.slice(p.i, j + 1);
    p.i = j + 1;
    return parseValue(raw, p.line);
  }
  let j = p.i;
  while (j < p.s.length && ![",", "]", "}"].includes(p.s[j])) j++;
  const raw = p.s.slice(p.i, j);
  p.i = j;
  return parseValue(raw, p.line);
}

/** Reads `key:` inside a flow map; the key is plain or quoted. */
function readKey(p) {
  let key;
  if (p.s[p.i] === '"' || p.s[p.i] === "'") {
    key = String(flow(p));
    skipWs(p);
    if (p.s[p.i] !== ":") throw new Error(`line ${p.line}: expected ":" after a key`);
    p.i++;
  } else {
    const j = p.s.indexOf(":", p.i);
    if (j < 0) throw new Error(`line ${p.line}: expected "key:" in a flow map`);
    key = p.s.slice(p.i, j).trim();
    p.i = j + 1;
  }
  return key;
}

/**
 * Removes a trailing comment (" #" outside quotes) and trailing spaces.
 * @param {string} s One line.
 * @returns {string}
 */
function stripComment(s) {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === "\\" && q === '"') i++;
      else if (c === q) q = null;
    } else if ((c === '"' || c === "'") && (i === 0 || /[\s:[{,-]/.test(s[i - 1]))) q = c;
    else if (c === "#" && (i === 0 || s[i - 1] === " ")) return s.slice(0, i).trimEnd();
  }
  return s.trimEnd();
}

/**
 * Splits `key: value` at the first ": " (or a trailing ":") outside quotes; undefined for a line that is not a map entry.
 * @param {string} s The text of a line without indentation or "- ".
 * @returns {{key: string, rest: string} | undefined}
 */
function splitEntry(s) {
  if (s[0] === '"' || s[0] === "'") {
    const q = s[0];
    let j = 1;
    while (j < s.length && s[j] !== q) j += q === '"' && s[j] === "\\" ? 2 : 1;
    const after = s.slice(j + 1);
    if (!/^:(\s|$)/.test(after)) return undefined;
    return { key: String(parseValue(s.slice(0, j + 1), 0)), rest: after.slice(1).trim() };
  }
  if (s[0] === "[" || s[0] === "{") return undefined;
  const m = /^([^\s:][^:]*?):(?:\s+(.*))?$/.exec(s);
  if (!m) return undefined;
  return { key: m[1], rest: (m[2] ?? "").trim() };
}

/**
 * Parses the YAML subset the ledger uses: block maps, block lists (of scalars or maps), one-line
 * scalars (plain, "double" or 'single' quoted) and one-line flow lists and maps. No multi-line
 * strings, anchors, tags or tabs: they throw with the line number, so a file the model wrote in
 * an unsupported shape fails loudly instead of being read wrongly. Strings that look like numbers
 * or hold ": " or " #" must be quoted.
 * @param {string} text The file's text.
 * @returns {unknown} A map, a list, or null for an empty file.
 */
export function parseYaml(text) {
  const lines = [];
  text.split(/\r?\n/).forEach((raw, idx) => {
    if (/^\s*\t/.test(raw) || /^ *\t/.test(raw)) throw new Error(`line ${idx + 1}: tabs are not allowed`);
    if (/^---\s*$/.test(raw)) return;
    const body = stripComment(raw);
    if (body.trim() === "") return;
    lines.push({ indent: body.length - body.trimStart().length, text: body.trim(), no: idx + 1 });
  });
  if (!lines.length) return null;
  let pos = 0;

  /** Parses the block at `indent`: a list or a map, depending on its first line. */
  const block = (indent) => {
    const first = lines[pos];
    if (first.text === "-" || first.text.startsWith("- ")) return list(indent);
    return map(indent);
  };

  /** The value after `key:` with nothing on the line: a deeper block, or null. */
  const nested = (parentIndent, allowSameIndentList) => {
    const next = lines[pos];
    if (!next) return null;
    if (next.indent > parentIndent) return block(next.indent);
    if (allowSameIndentList && next.indent === parentIndent && (next.text === "-" || next.text.startsWith("- "))) return list(parentIndent);
    return null;
  };

  const map = (indent, firstEntry) => {
    const out = {};
    let pending = firstEntry;
    for (;;) {
      let entry;
      let no;
      if (pending) {
        ({ entry, no } = pending);
        pending = undefined;
      } else {
        const l = lines[pos];
        if (!l || l.indent < indent) return out;
        if (l.indent > indent) throw new Error(`line ${l.no}: unexpected indentation`);
        if (l.text === "-" || l.text.startsWith("- ")) return out;
        entry = splitEntry(l.text);
        no = l.no;
        if (!entry) throw new Error(`line ${l.no}: expected "key: value"`);
        pos++;
      }
      if (entry.key in out) throw new Error(`line ${no}: duplicate key "${entry.key}"`);
      out[entry.key] = entry.rest === "" ? nested(indent, true) : parseValue(entry.rest, no);
    }
  };

  const list = (indent) => {
    const out = [];
    for (;;) {
      const l = lines[pos];
      if (!l || l.indent < indent) return out;
      if (l.indent > indent) throw new Error(`line ${l.no}: unexpected indentation`);
      if (!(l.text === "-" || l.text.startsWith("- "))) return out;
      pos++;
      const item = l.text === "-" ? "" : l.text.slice(2).trim();
      if (item === "") {
        out.push(nested(indent, false));
        continue;
      }
      const entry = splitEntry(item);
      if (entry) {
        // A map whose first key sits on the "- " line; its other keys line up with it.
        const keyIndent = indent + (l.text.length - l.text.slice(2).trimStart().length);
        out.push(map(keyIndent, { entry, no: l.no }));
      } else {
        out.push(parseValue(item, l.no));
      }
    }
  };

  const result = block(lines[0].indent);
  if (pos < lines.length) throw new Error(`line ${lines[pos].no}: unexpected content`);
  return result;
}

// ------------------------------------------------------------------ the checks

/** @returns {number} The phase's position in PHASES, or -1. */
const phaseIndex = (state) => PHASES.indexOf(String(state?.phase ?? ""));

/** @returns {unknown[]} `v` when it is a list, else []. */
const asList = (v) => (Array.isArray(v) ? v : []);

/**
 * Placeholders that must not survive into a draft. Case-insensitive; looked for outside fenced and inline code
 * only (a code sample may say TODO), so a placeholder inside a code block is not caught by design.
 */
const PLACEHOLDERS = [
  [/\bto-?do\b/i, "TODO"],
  [/\bfixme\b/i, "FIXME"],
  [/\btbd\b/i, "TBD"],
  [/\bto be (?:determined|defined|decided|added|written)\b/i, "to be determined"],
  [/\bcoming soon\b/i, "coming soon"],
  [/\bdraft:[A-Za-z0-9_-]+/, "draft:<key> link"],
  [/\{\{[^}]*\}\}/, "{{template}} field"],
  [/<<[^>]*>>/, "<<placeholder>>"],
  [/\b(?:lorem ipsum|XXX+)\b/i, "filler text"],
];

/**
 * The secret-scan patterns, mirrored from the gateway's secret scan, as source and flags.
 * A test in the private repository compares this list with the gateway's, so they can't drift apart.
 * Unit texts and drafts are scanned for them: a hit is a secret that must not enter the ledger or a page.
 */
export const SECRET_PATTERN_SOURCES = [
  ["private-key", "-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----(?:(?:(?!-----BEGIN )[\\s\\S]){0,16384}?-----END [A-Z ]{0,40}PRIVATE KEY-----|[A-Za-z0-9+/=\\r\\n]{0,16384})", "g"],
  ["aws-access-key", "\\bAKIA[0-9A-Z]{16}\\b", "g"],
  ["github-token", "\\bgh[pousr]_[A-Za-z0-9]{36,255}", "g"],
  ["slack-token", "\\bxox[abpr]-[A-Za-z0-9-]{10,255}", "g"],
  ["bookstack-token", "\\b[A-Za-z0-9]{32}:[A-Za-z0-9]{32}\\b", "g"],
  ["password", "\\b(?:password|passwort|kennwort|passwd|pwd|psk|wpa2?(?:[ -]key)?)\\s{0,16}[:=]\\s{0,16}\\S{4}[^\\r\\n]{0,252}", "gi"],
  ["url-credentials", "\\b[a-z][a-z0-9+.-]{0,31}:\\/\\/[^\\s/:@]{1,256}:[^\\s/@]{1,256}@", "gi"],
  ["api-key", "\\b(?:api[_-]?key|secret|token)\\s{0,16}[:=]\\s{0,16}[\"']?[A-Za-z0-9_-]{16}[A-Za-z0-9_\\-./+=]{0,240}", "gi"],
];

/**
 * Which secret patterns a text hits (ids only, never the match).
 * @param {string} text The text.
 * @returns {string[]} Pattern ids.
 */
export function secretHits(text) {
  return SECRET_PATTERN_SOURCES.filter(([, src, flags]) => new RegExp(src, flags).test(text)).map(([id]) => id);
}

/**
 * Strips fenced and inline code from markdown, so words in examples are not checked.
 * @param {string} md The page markdown.
 * @returns {string}
 */
function withoutCode(md) {
  const kept = [];
  let fence = null; // {ch, len} while inside a fenced block
  for (const line of md.split("\n")) {
    if (fence) {
      const close = /^[ \t>]*(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (close && close[1][0] === fence.ch && close[1].length >= fence.len) fence = null;
      continue;
    }
    // an opener: any indent (top level up to 3 spaces, deeper inside list items or quotes), optional list/quote marker
    const open = /^[ \t>]*(?:(?:[-*+]|\d+[.)])[ \t]+)?(`{3,}|~{3,})(?!.*`)/.exec(line);
    if (open) {
      fence = { ch: open[1][0], len: open[1].length };
      continue;
    }
    kept.push(line);
  }
  return kept.join("\n").replace(/`[^`\n]*`/g, "");
}

/**
 * Problems in one draft: placeholders, links that resolve to nothing, references to tables or figures that are not on the page.
 * @param {string} key The plan page's key (for messages).
 * @param {string} md The draft markdown.
 * @param {Set<string>} planKeys Every key in plan.yaml.
 * @param {{final?: boolean, published?: Map<string, unknown>}} opts `final`: a ledger: link is an error.
 * @returns {string[]} Messages.
 */
export function checkDraft(key, md, planKeys, opts = {}) {
  const problems = [];
  if (md.trim() === "") return [`draft ${key}: the draft is empty`];
  // --final: any "ledger:" left in the raw text (angle-bracket, HTML, reference-style, bare, in code), not just inline links.
  if (opts.final && /(?<![\w])ledger:(?=[A-Za-z0-9_])/i.test(md)) problems.push(`draft ${key}: "ledger:" is still in the text (the link pass should have made every link /link/<id>)`);
  for (const id of secretHits(md)) problems.push(`draft ${key}: matches the secret pattern ${id}`);
  const text = withoutCode(md);
  for (const [re, label] of PLACEHOLDERS) if (re.test(text)) problems.push(`draft ${key}: placeholder left (${label})`);

  for (const m of text.matchAll(/!?\[[^\]]*\]\(([^)\s]*)(?:\s+"[^"]*")?\)/g)) {
    const url = m[1];
    if (url === "") problems.push(`draft ${key}: empty link target`);
    else if (url.startsWith("#") || /^(https?:\/\/|mailto:)/i.test(url)) continue;
    else if (/^ledger:/.test(url)) {
      const target = url.slice("ledger:".length).replace(/#.*$/, "");
      if (!planKeys.has(target)) problems.push(`draft ${key}: link ${url} points to no page in plan.yaml`);
      else if (opts.final) problems.push(`draft ${key}: link ${url} is still a ledger link (the link pass should make it /link/<id>)`);
    } else if (/^\/link\/\d+(#.*)?$/.test(url)) continue;
    else problems.push(`draft ${key}: link "${url}" is neither a wiki /link/<id>, a ledger:<key> nor an absolute URL`);
  }

  const lines = text.split("\n");
  const tables = lines.filter((l) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(l)).length;
  const images = (text.match(/!\[[^\]]*\]\([^)]*\)/g) ?? []).length + (text.match(/drawio-diagram/g) ?? []).length;
  const label = (word, id) => `${/^(Table|Tabelle)$/.test(word) ? "table" : "figure"} ${id}`;
  const CAPTION = /^[\s#>*_]*(Table|Figure|Fig\.|Tabelle|Abbildung)\s+(\d+|[A-Z])\s*[:.\u2014-]/;
  const captions = new Set();
  for (const l of lines) {
    const c = CAPTION.exec(l);
    if (c) captions.add(label(c[1], c[2]));
  }
  for (const l of lines) {
    if (CAPTION.test(l)) continue; // a caption line defines its label; it does not refer to one
    for (const m of l.matchAll(/\b(Table|Figure|Fig\.|Tabelle|Abbildung)\s+(\d+|[A-Z])\b/g)) {
      if (!captions.has(label(m[1], m[2]))) problems.push(`draft ${key}: refers to "${m[0]}", which has no caption on the page`);
    }
  }
  if (/\b(?:the|this|following|above|below)\s+tables?\s+(?:below|above)\b|\bsee\s+the\s+table\b|\bthe\s+table\s+(?:below|above)\b/i.test(text) && tables === 0) {
    problems.push(`draft ${key}: points to a table "above" or "below", and the page has none`);
  }
  if (/\b(?:the\s+)?(?:figure|diagram|image|screenshot|picture|photo)\s+(?:below|above)\b/i.test(text) && images === 0) {
    problems.push(`draft ${key}: points to a figure or image "above" or "below", and the page has none`);
  }
  return [...new Set(problems)];
}

// ------------------------------------------------------- content-structure checks

/**
 * The level-2 headings of a draft with the text under each (a level-3 heading and its text belong to the section above).
 * Code blocks are ignored, so a `## x` in a sample is no heading.
 * @param {string} md The draft markdown.
 * @returns {Array<{title: string, body: string}>}
 */
export function sections(md) {
  const out = [];
  for (const line of withoutCode(md).split("\n")) {
    const h = /^##[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
    if (h && !line.startsWith("###")) out.push({ title: h[1].replace(/[*_`]/g, "").trim(), body: "" });
    else if (out.length) out[out.length - 1].body += `${line}\n`;
  }
  return out;
}

/** A section body counts as empty when nothing is left after comments, dashes, ellipses and placeholder words. */
const EMPTY_LINE = /^(?:[-*_>.…—–|\s]*|n\/?a|tbd|todo|fixme|none|none yet|empty|placeholder|\.\.\.)\.?$/i;

/**
 * @param {string} body The text under a heading.
 * @returns {boolean} Whether it is blank or only a placeholder.
 */
function isEmptySection(body) {
  return body
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n")
    .every((l) => EMPTY_LINE.test(l.trim()));
}

/**
 * Checks a draft against the template headings its plan page lists: each one present as a level-2 heading, in the
 * template's order, with content under it. Extra headings are fine.
 * @param {string} key The plan page's key (for messages).
 * @param {string} md The draft markdown.
 * @param {string[]} template The headings, in order.
 * @returns {string[]} Messages.
 */
export function checkTemplate(key, md, template) {
  const problems = [];
  const secs = sections(md);
  const same = (a, b) => a.toLowerCase().replace(/\s+/g, " ") === b.toLowerCase().replace(/\s+/g, " ");
  let lastIdx = -1;
  let lastName = "";
  for (const h of template) {
    const idx = secs.findIndex((s) => same(s.title, String(h).trim()));
    if (idx < 0) {
      problems.push(`draft ${key}: template heading "${h}" is missing (a level-2 heading "## ${h}")`);
      continue;
    }
    if (isEmptySection(secs[idx].body)) problems.push(`draft ${key}: the section "${h}" is empty or only a placeholder`);
    if (idx < lastIdx) problems.push(`draft ${key}: "${h}" comes before "${lastName}"; the template's order is ${template.join(" > ")}`);
    else {
      lastIdx = idx;
      lastName = String(h);
    }
  }
  return problems;
}

/**
 * The Area (book name) a filing string puts a page in, or undefined outside the Areas shelf. Filing is "Shelf › Book › Chapter".
 * @param {unknown} filing The plan page's filing.
 * @returns {string | undefined}
 */
export function areaOf(filing) {
  const parts = String(filing ?? "").split(/\s*[›>]\s*/).map((x) => x.trim());
  return parts.length >= 2 && /^areas$/i.test(parts[0]) && parts[1] ? parts[1] : undefined;
}

/**
 * Page type against the units placed on it. `soft` messages are problems from verify on, warnings before; `warn` ones are always warnings.
 * T1 a changelog or todo unit is placed; T2 a procedure unit on a page that is neither task, also:task nor a log;
 * T3 a data unit on a concept or task page in an Area (method/data split) without also:reference or a mixed decision;
 * T4 a decision unit on a page that is not a note (or is a log), or on a page that holds other kinds too.
 * @param {any} page The plan page.
 * @param {any[]} placed The units placed on it.
 * @param {Set<string>} mixedOk Plan keys a recorded decision lets mix method and data.
 * @returns {{soft: string[], warn: string[]}}
 */
export function checkPageType(page, placed, mixedOk) {
  const soft = [];
  const warn = [];
  const key = String(page.key);
  const kinds = new Set(placed.map((u) => u.kind));
  const also = (Array.isArray(page.also) ? page.also : page.also ? [page.also] : []).map(String);
  const type = String(page.type ?? "");
  const form = String(page.form ?? "");
  for (const u of placed) {
    if (u.kind === "changelog" || u.kind === "todo") soft.push(`plan ${key}: unit ${u.id} is a ${u.kind}, which belongs to the repository or tracker, not a page (scope rule); drop it or link it`);
  }
  if (!placed.length) return { soft, warn };
  if (!type) {
    soft.push(`plan ${key}: no type, so the type-against-content check cannot run`);
    return { soft, warn };
  }
  if (kinds.has("procedure") && type !== "task" && !also.includes("task") && form !== "log") {
    soft.push(`plan ${key}: ${placed.filter((u) => u.kind === "procedure").map((u) => u.id).join(", ")} is a procedure, but the page is type ${type}${also.length ? ` also ${also.join("/")}` : ""}; a procedure needs type task or also: task`);
  }
  if (areaOf(page.filing) && kinds.has("data") && (type === "concept" || type === "task") && !also.includes("reference") && !mixedOk.has(key)) {
    soft.push(`plan ${key}: ${placed.filter((u) => u.kind === "data").map((u) => u.id).join(", ")} is data on a ${type} page in an Area; split the numbers onto a reference page or the prototype book, or record a decision with mixed: ${key}`);
  }
  if (kinds.has("decision")) {
    if (type !== "note" || form === "log") warn.push(`plan ${key}: a decision unit sits on a page of type ${type}${form ? ` (${form})` : ""}; a decision is one atomic note (adr template)`);
    else if ([...kinds].some((k) => k !== "decision")) warn.push(`plan ${key}: a decision unit shares its page with ${[...kinds].filter((k) => k !== "decision").join(", ")} units; an ADR note holds one decision`);
  }
  return { soft, warn };
}

/**
 * Area overview pages: a plan that creates pages in an Area (filing "Areas › <Area> › ...") must also edit that Area's overview page.
 * `state.overview` maps the Area to the id of its overview page (or `none` when it has none yet); the plan satisfies it with an
 * `update` page whose page_id is that id, or a page with `overview_of: <Area>` (a create when there is none yet). A recorded decision
 * with `skip_overview: <Area>` waives it.
 * @param {any[]} pages The plan's pages.
 * @param {any} state The parsed state.yaml.
 * @returns {string[]} Messages (soft: problems from verify on, warnings before).
 */
export function checkOverviews(pages, state) {
  const out = [];
  const overview = state?.overview && typeof state.overview === "object" && !Array.isArray(state.overview) ? state.overview : {};
  const lookup = (area) => Object.entries(overview).find(([k]) => k.toLowerCase() === area.toLowerCase())?.[1];
  const waived = new Set(userDecisions(state).map((d) => String(d?.skip_overview ?? "").toLowerCase()).filter(Boolean));
  const areas = new Map();
  for (const p of pages) {
    const area = p?.action === "create" ? areaOf(p.filing) : undefined;
    if (area) areas.set(area.toLowerCase(), area);
  }
  for (const [lc, area] of areas) {
    if (waived.has(lc)) continue;
    const id = lookup(area);
    if (id == null) {
      out.push(`plan: creates pages in the Area "${area}", but state.yaml overview has no entry for it (find its overview page with get_wiki_structure or search_wiki: overview: {${area}: <page id>}, or none)`);
      continue;
    }
    const edited = pages.some((p) => p?.action !== "archive" && ((String(p?.overview_of ?? "").toLowerCase() === lc && (id === "none" || p.action === "create" || String(p.page_id) === String(id))) || (id !== "none" && p?.action === "update" && String(p.page_id) === String(id))));
    if (!edited) out.push(`plan: creates pages in the Area "${area}" but no plan page edits its overview page${id === "none" ? " (state says it has none: plan a create with overview_of: " + area + ")" : ` ${id}`}; add one or record a decision with skip_overview: ${area}`);
  }
  return out;
}

/**
 * Orders plan pages so a page comes after the new pages it links to. Pages in a cycle can't be ordered: they are listed apart, and the link pass fixes their links.
 * @param {Array<{key: string, links_to?: string[]}>} pages The plan's pages.
 * @returns {{order: string[], cycles: string[]}}
 */
export function publishOrder(pages) {
  const keys = new Set(pages.map((p) => p.key));
  const deps = new Map(pages.map((p) => [p.key, new Set(asList(p.links_to).map(String).filter((k) => keys.has(k) && k !== p.key))]));
  const order = [];
  const left = new Set(keys);
  for (;;) {
    const ready = [...left].filter((k) => [...deps.get(k)].every((d) => !left.has(d)));
    if (!ready.length) break;
    for (const k of ready) {
      order.push(k);
      left.delete(k);
    }
  }
  return { order, cycles: [...left] };
}

/** The changeset limits, mirrored from the gateway, with a margin on the markdown so a set is not at the edge. */
export const CHANGESET_LIMITS = { ops: 40, creates: 25, chars: 1_200_000 };

/** What a state.yaml `changesets` entry's status may be. */
const CHANGESET_STATUSES = ["previewed", "applied", "stopped", "dropped"];

/**
 * Groups the plan's pages into changesets: pages go in dependency order (a page after the new pages it links), whole layers together, and a layer is split only when the limits force it.
 * Pages in one layer don't link each other, so a split inside a layer is safe; between layers a later changeset links the earlier pages by their real /link/<id>.
 * Pages in a cycle are created in the layer after everything they can be ordered after, without their links to each other, and the links go in one later changeset of edits (`fixups`).
 * @param {Array<{key: string, action?: string, links_to?: string[]}>} pages The plan's pages (archive rows are no changeset ops and are left out).
 * @param {(key: string) => number} [size] The characters of a page's draft, for the markdown limit.
 * @param {{ops: number, creates: number, chars: number}} [limits] The gateway's limits.
 * @returns {{changesets: Array<{keys: string[], creates: number, edits: number, chars: number}>, cycles: string[], fixups: string[]}}
 */
export function changesetBatches(pages, size = () => 0, limits = CHANGESET_LIMITS) {
  const live = pages.filter((p) => p.key && p.action !== "archive");
  const { order, cycles } = publishOrder(live);
  const byKey = new Map(live.map((p) => [p.key, p]));
  const keys = new Set(live.map((p) => p.key));
  const deps = (k) => asList(byKey.get(k)?.links_to).map(String).filter((d) => keys.has(d) && d !== k && !cycles.includes(d));
  const layer = new Map();
  for (const k of order) layer.set(k, deps(k).reduce((n, d) => Math.max(n, (layer.get(d) ?? 0) + 1), 0));
  // Cycle pages are written without their links to each other, so they depend only on the ordered pages they link.
  for (const k of cycles) layer.set(k, deps(k).reduce((n, d) => Math.max(n, (layer.get(d) ?? 0) + 1), 0));
  const ordered = [...order, ...cycles].sort((a, b) => layer.get(a) - layer.get(b));
  const out = [];
  let cur = { keys: [], creates: 0, edits: 0, chars: 0 };
  const flush = () => {
    if (cur.keys.length) out.push({ keys: cur.keys, creates: cur.creates, edits: cur.edits, chars: cur.chars });
    cur = { keys: [], creates: 0, edits: 0, chars: 0 };
  };
  for (const k of ordered) {
    const p = byKey.get(k);
    const create = p.action === "create";
    const chars = size(k);
    const fits = cur.keys.length + 1 <= limits.ops && cur.creates + (create ? 1 : 0) <= limits.creates && cur.chars + chars <= limits.chars;
    if (!fits) flush();
    cur.keys.push(k);
    if (create) cur.creates++;
    else cur.edits++;
    cur.chars += chars;
  }
  flush();
  const fixups = cycles.filter((k) => asList(byKey.get(k)?.links_to).some((d) => cycles.includes(String(d))));
  return { changesets: out, cycles, fixups };
}

/**
 * Normalises text for comparing two units of one subject.
 * @param {unknown} t A unit's text.
 * @returns {string}
 */
const norm = (t) => String(t ?? "").toLowerCase().replace(/\s+/g, " ").replace(/[.;,\s]+$/, "").trim();

/**
 * The decisions the human made: only an entry with `decided_by: user` counts (Claude may suggest, never choose).
 * @param {any} state The parsed state.yaml.
 * @returns {any[]}
 */
export const userDecisions = (state) => asList(state?.decisions).filter((d) => d && typeof d === "object" && d.decided_by === "user");

/**
 * The decisions of state.yaml by id (only the human's).
 * @param {any} state The parsed state.yaml.
 * @returns {Set<string>}
 */
const decisionIds = (state) => new Set(userDecisions(state).map((d) => String(d.id ?? "")).filter(Boolean));

/** @returns {boolean} Whether a unit is placed on a page (keep or merge). */
const isPlacedUnit = (u) => Boolean(u) && (u.verdict === "keep" || u.verdict === "merge");

// ------------------------------------------------- wiki sweep (Step M3b)

/** Smallest `limit` a sweep search may use (sweep_wiki's default). A repeat with SWEEP_LIMIT_WIDE needs a `repeat_why`. */
export const SWEEP_MIN_LIMIT = 20;
/** The `limit` of the one repeat of a sweep search (the server's maximum). */
export const SWEEP_LIMIT_WIDE = 50;
/** Most topics a job's sweep may have (unit subjects are grouped into topics at Step M3b). */
export const MAX_TOPICS = 15;
/** How a sweep record was made: the wiki structure (list_pages, or one search per book), sweep_wiki, or plain search_wiki calls. */
export const SWEEP_VIA = ["structure", "sweep_wiki", "search_wiki"];

/** Where a source lives (inventory `kind`). */
export const SOURCE_KINDS = ["wiki", "onedrive", "sharepoint", "github", "local"];

/** What a github row may be proposed: history and pins hang on a file, so never delete, move or rename it. */
export const GITHUB_DISPOSITIONS = ["edit", "keep-linked", "leave"];

/** @returns {boolean} Whether an inventory row is a live wiki page (its units can't be dropped without the human). */
const isWikiSource = (s) => Boolean(s) && (s.kind === "wiki" || s.page_id != null);

/**
 * Whether an inventory row is a repository file: kind github, or a repo field or a github.com URL, so a row with a wrong kind
 * cannot slip past the repository rules (no delete, move or rename; an edit on a branch with a pull request).
 * @param {any} s An inventory row.
 * @returns {boolean}
 */
export const isRepoSource = (s) => Boolean(s) && (s.kind === "github" || s.repo != null || /^https?:\/\/(www\.)?github\.com\//i.test(String(s.url ?? "")));

/** Branch names an edit of a repository file may never be recorded on. */
const DEFAULT_BRANCHES = ["main", "master"];

/**
 * Normalises a source path or URL for comparing: URLs keep their text (minus a trailing slash); a path becomes posix, without "./", a leading or trailing slash.
 * @param {unknown} p A path or URL.
 * @returns {string}
 */
export function normPath(p) {
  const t = String(p ?? "").trim().replace(/\\/g, "/");
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return t.replace(/\/+$/, "");
  return posix.normalize(t).replace(/^(\.\/)+/, "").replace(/^\/+/, "").replace(/\/+$/, "");
}

/**
 * A key for deciding whether two source paths or URLs name the same file: normPath, URL escapes decoded and lower-cased,
 * because OneDrive and SharePoint paths are case-insensitive (a GitHub path differing only in case then also counts as the
 * same, which only ever blocks a delete or adds a match the human sees).
 * @param {unknown} p A path or URL.
 * @returns {string}
 */
export function pathKey(p) {
  let t = String(p ?? "");
  try {
    t = decodeURIComponent(t);
  } catch {
    // a lone % stays as it is
  }
  return normPath(t).toLowerCase();
}

/** @returns {boolean} Whether a path has a ".." segment (before or after normalising). */
const hasDotDot = (p) => String(p ?? "").replace(/\\/g, "/").split("/").includes("..") || normPath(p).split("/").includes("..");

/**
 * Whether a decision of the human is about this unit: its `subject` equals the unit's subject, or it lists the unit in `units`
 * (or, with `srcId`, lists that source row in `rows`). A decision about another subject settles nothing here.
 * @param {any} d A decision.
 * @param {any} u A unit.
 * @param {string} [srcId] A source row id the decision may name in `rows`.
 * @returns {boolean}
 */
function decisionNames(d, u, srcId) {
  return (u?.subject != null && String(d?.subject ?? "") === String(u.subject)) || asList(d?.units).map(String).includes(String(u?.id)) || (srcId != null && asList(d?.rows).map(String).includes(String(srcId)));
}

/**
 * Whether the unit's own `decision` is a user decision that names it (its subject or its id, or with `srcId` its source row).
 * @param {any} state The parsed state.yaml.
 * @param {any} u A unit.
 * @param {string} [srcId] A source row id.
 * @returns {boolean}
 */
function hasNamedDecision(state, u, srcId) {
  const d = userDecisions(state).find((x) => String(x.id) === String(u?.decision ?? ""));
  return Boolean(d) && decisionNames(d, u, srcId);
}

/**
 * The unit subjects that need a sweep record: every subject of a unit that carries knowledge (not a secret, changelog or todo),
 * is not superseded, was not typed in by the human and does not come from a page the sweep itself added (one round only).
 * @param {any[]} units All units.
 * @param {any[]} sources The inventory rows.
 * @returns {Set<string>}
 */
export function sweepSubjects(units, sources) {
  const byId = new Map(sources.map((s) => [String(s?.id), s]));
  const out = new Set();
  for (const u of units) {
    if (!u?.subject || ["secret", "changelog", "todo"].includes(u.kind) || u.superseded_by != null || u.origin === "human") continue;
    if (byId.get(String(u.source))?.added_by === "sweep") continue;
    out.add(String(u.subject));
  }
  return out;
}

// ------------------------------------------------- policies, page store and sweep (Steps M1, M3b)

/** The questions asked up front at Step M1; each answer is `state.yaml policies.<key>` (decided_by: user) or the string POLICY_NA. */
export const POLICY_KEYS = ["scope", "currency", "needs_ok", "media", "third_party", "outside_docs", "archived", "reorganisations", "out_of_scope"];

/** What a policy that does not apply says. */
export const POLICY_NA = "asked: not applicable";

/** What `policies.media.mode` may be: link recordings to their decks, decompose them, or ignore them. */
export const MEDIA_MODES = ["link", "decompose", "ignore"];

/** States of a page-store row (pages.yaml). */
export const PAGE_STATES = ["listed", "candidate", "triaged-out", "digested", "compared", "blocked"];

/** How a compare run may class a unit against a page: covered (optionally `covered#section`), partly, new or conflict. */
export const COMPARE_RE = /^(covered(#.+)?|partly|new|conflict)$/;

/**
 * Checks the up-front answers of Step M1: from phase decompose on every policy key is present, either the string "asked: not applicable"
 * or a map with the human's words (`text`) and `decided_by: user`.
 * @param {any} state The parsed state.yaml.
 * @returns {string[]} Problems.
 */
export function checkPolicies(state) {
  const out = [];
  const pol = state?.policies && typeof state.policies === "object" && !Array.isArray(state.policies) ? state.policies : {};
  for (const k of POLICY_KEYS) {
    const v = pol[k];
    if (v === undefined) out.push(`state.yaml policies: "${k}" is missing; ask the intake questions at Step M1 in one batch (an answer that does not apply is the string "${POLICY_NA}")`);
    else if (typeof v === "string") {
      if (v !== POLICY_NA) out.push(`policies.${k}: a plain string must be exactly "${POLICY_NA}"; otherwise a map with text and decided_by: user`);
    } else if (!v || typeof v !== "object" || Array.isArray(v) || v.decided_by !== "user" || !String(v.text ?? "").trim()) {
      out.push(`policies.${k}: needs text (the human's words) and decided_by: user`);
    } else if (k === "media" && v.mode != null && !MEDIA_MODES.includes(v.mode)) out.push(`policies.media: mode "${v.mode}" is not one of ${MEDIA_MODES.join(", ")}`);
  }
  return out;
}

/**
 * Key of a page-store row: the wiki page id, or the OneDrive `ref` (driveId:itemId).
 * @param {any} r A pages.yaml row.
 * @returns {string | undefined}
 */
export const pageKey = (r) => (r?.id != null ? String(r.id) : r?.ref != null ? String(r.ref) : undefined);

/**
 * Ids (numbers) of the pages already judged (triaged-out, digested, compared, blocked): the `known` list of sweep_wiki, so they come back without a snippet.
 * @param {any[]} rows The pages.yaml rows.
 * @returns {Array<string | number>}
 */
export function knownPages(rows) {
  return rows.filter((r) => r?.id != null && ["triaged-out", "digested", "compared", "blocked"].includes(r.state)).map((r) => Number(r.id)).filter((n) => Number.isFinite(n));
}

/**
 * Checks the page store (pages.yaml), from phase sweep on. Each row has an id (wiki page) or ref (OneDrive file), a title and a state;
 * a digested or compared row has headings and a short digest (never page text); a blocked row has metadata only; a row triaged out of a
 * top-5 hit says why; `compared` maps unit ids to covered[#section] / partly / new / conflict; a digested row that matches a topic of the job
 * is compared or declined; a unit compared `conflict` needs the human's decision from draft on; at publish each page the plan edits was
 * re-read (`revision_rechecked`) and still has the revision it was digested at.
 * @param {{rows: any[], units: any[], plan: any[], state: any, atPlan: boolean, atDraft: boolean, atPublish: boolean}} a The parsed files and phase flags.
 * @returns {{problems: string[], warnings: string[]}}
 */
export function checkPages({ rows, units, plan, state, atPlan, atDraft, atPublish }) {
  const problems = [];
  const warnings = [];
  const seen = new Set();
  const unitIds = new Set(units.map((u) => String(u?.id)));
  const user = new Map(userDecisions(state).map((d) => [String(d.id), d]));
  for (const r of rows) {
    const key = pageKey(r);
    const label = `pages ${key ?? "?"}`;
    if (key === undefined) {
      problems.push("pages.yaml: a row needs id (wiki page) or ref (OneDrive file)");
      continue;
    }
    if (seen.has(key)) problems.push(`${label}: duplicate row`);
    seen.add(key);
    if (!r.title) problems.push(`${label}: no title`);
    if (!PAGE_STATES.includes(r.state)) {
      problems.push(`${label}: state "${r.state ?? ""}" is not one of ${PAGE_STATES.join(", ")}`);
      continue;
    }
    const heads = asList(r.headings);
    if ((r.state === "digested" || r.state === "compared") && (!heads.length || !String(r.digest ?? "").trim())) problems.push(`${label}: a ${r.state} row needs headings and a digest (the reader writes them once; later topics are judged from the row)`);
    if (r.digest != null && String(r.digest).length > 700) warnings.push(`${label}: the digest is over 700 characters; 3-5 lines, never page text`);
    if (r.state === "blocked" && (heads.length || r.digest)) problems.push(`${label}: a blocked page keeps metadata only; no headings or digest`);
    if (r.state === "triaged-out" && r.best_rank != null && Number(r.best_rank) <= 5 && !r.triage_why) problems.push(`${label}: triaged out of a top-5 hit (rank ${r.best_rank}) without triage_why; a bare title is enough only for lower ranks`);
    if (atPlan && r.state === "candidate" && r.declined == null) problems.push(`${label}: still a candidate; digest it, or triage it out`);
    if (r.declined != null && !user.has(String(r.declined))) problems.push(`${label}: declined by ${r.declined}, which is not a decision with decided_by: user`);
    const cmp = r.compared && typeof r.compared === "object" && !Array.isArray(r.compared) ? r.compared : {};
    if (r.state === "compared" && !Object.keys(cmp).length) problems.push(`${label}: state compared but no compared entries`);
    for (const [uid, cls] of Object.entries(cmp)) {
      if (!unitIds.has(uid)) problems.push(`${label}: compared names ${uid}, which is not a unit`);
      else if (!COMPARE_RE.test(String(cls))) problems.push(`${label}: compared ${uid} is "${cls}"; use covered[#section], partly, new or conflict`);
      else if (cls === "conflict" && atDraft && !userDecisions(state).some((d) => asList(d.units).map(String).includes(uid) || (String(d.subject ?? "") === String(units.find((u) => String(u.id) === uid)?.subject ?? "\0") && asList(d.pages).map(String).includes(key)))) {
        problems.push(`${label}: unit ${uid} conflicts with this page, and no decision of the human lists the unit (units: [${uid}]) or names its subject together with this page (subject + pages: [${key}]) (Step M5)`);
      }
    }
    if (atPlan && r.state === "digested" && asList(r.topics).length && r.declined == null && !Object.keys(cmp).length) problems.push(`${label}: a digested page on topic ${asList(r.topics).join(", ")} was never compared with the units (compare mode), and is not declined`);
  }
  if (atPublish) {
    const byId = new Map(rows.filter((r) => r?.id != null).map((r) => [String(r.id), r]));
    for (const p of plan) {
      if (!p || (p.action !== "update" && p.action !== "archive") || p.page_id == null) continue;
      const row = byId.get(String(p.page_id));
      if (!row) {
        problems.push(`plan ${p.key}: edits page ${p.page_id}, which has no row in pages.yaml; read it (get_page) and record its revision`);
        continue;
      }
      if (row.revision_rechecked == null) problems.push(`plan ${p.key}: page ${p.page_id} is edited but its revision was not re-read before publishing (revision_rechecked)`);
      else if (row.revision == null && row.reread !== "get_page") problems.push(`plan ${p.key}: page ${p.page_id} has no revision in its row (a keyword-only or degraded result carries none), so drift can't be seen; re-read it with get_page and record reread: get_page (and compare its units again if it changed)`);
      else if (row.revision != null && String(row.revision_rechecked) !== String(row.revision)) problems.push(`plan ${p.key}: page ${p.page_id} is at revision ${row.revision_rechecked}, it was digested at ${row.revision}; read it again, update its row, and preview again`);
    }
  }
  return { problems, warnings };
}

/**
 * Checks the sweep searches (sweep.yaml), from phase sweep on: each record has a topic, a `via` (structure, sweep_wiki, search_wiki) and an outcome;
 * a structure record names the `books` listed and how many pages (`listed`); a search record has `queries`, `limit` (at least 20; a repeat with 50
 * needs `repeat_why`), `returned` equal to the `ranks` recorded, and every rank has a row in pages.yaml. At most MAX_TOPICS topics, a subject
 * in one topic only, and, from phase plan on, every unit subject is listed under a topic.
 * @param {{units: any[], sources: any[], sweep: any, pages: any, atSweep: boolean, atPlan: boolean}} a The parsed files and phase flags (pages: the parsed pages.yaml or undefined).
 * @returns {{problems: string[], warnings: string[]}}
 */
export function checkSweep({ units, sources, sweep, pages, atSweep, atPlan }) {
  const problems = [];
  const warnings = [];
  const records = asList(sweep?.sweeps);
  const rowKeys = new Set(asList(pages?.pages).map(pageKey).filter((k) => k !== undefined));
  const topics = new Set();
  const topicOf = new Map();
  for (const r of records) {
    const topic = String(r?.topic ?? r?.subject ?? "");
    const label = `sweep ${r?.id ?? (topic || "?")}`;
    if (!topic) {
      problems.push(`${label}: a sweep record needs a topic`);
      continue;
    }
    topics.add(topic);
    for (const s of r.subjects != null ? asList(r.subjects) : r.subject != null ? [r.subject] : []) {
      const prev = topicOf.get(String(s));
      if (prev !== undefined && prev !== topic) problems.push(`${label}: subject "${s}" is under the topics "${prev}" and "${topic}"; one topic per subject`);
      topicOf.set(String(s), topic);
    }
    if (r.hits != null) warnings.push(`${label}: per-hit lists are not read any more; every page's class lives once in pages.yaml, the record keeps ranks`);
    if (!atSweep) continue;
    if (!SWEEP_VIA.includes(r.via)) problems.push(`${label}: via must be one of ${SWEEP_VIA.join(", ")}`);
    if (!r.outcome) problems.push(`${label}: no outcome (what became of the pages)`);
    if (r.via === "structure") {
      if (!asList(r.books).length && !asList(r.chapters).length) problems.push(`${label}: a structure record names the books or chapters it listed`);
      if (!Number.isInteger(Number(r.listed)) || r.listed == null) problems.push(`${label}: a structure record needs listed (how many pages it put into pages.yaml)`);
      continue;
    }
    if (!asList(r.queries).length && !r.query) problems.push(`${label}: no queries (what was asked)`);
    // a query named in sweep_wiki's `errors` and not answered by the retry with search_wiki is recorded, never dropped silently
    if (r.failed != null && (!Array.isArray(r.failed) || r.failed.some((f) => !f || typeof f !== "object" || !f.query || !f.message))) problems.push(`${label}: failed must list {query, message} for each query that errored even after the retry with search_wiki`);
    const returned = Number(r.returned);
    const limit = Number(r.limit);
    const ranks = asList(r.ranks);
    if (r.returned == null || !Number.isInteger(returned) || returned < 0) problems.push(`${label}: no returned (how many ranked pages the search gave)`);
    else if (!Array.isArray(r.ranks)) problems.push(`${label}: ranks must be a list of page ids (or OneDrive refs)`);
    else if (ranks.length !== returned) problems.push(`${label}: returned ${returned} but ${ranks.length} ranks are recorded`);
    if (r.limit == null || !Number.isInteger(limit) || limit < SWEEP_MIN_LIMIT) problems.push(`${label}: limit ${r.limit ?? "missing"}; use ${SWEEP_MIN_LIMIT} at least`);
    else if (limit > SWEEP_MIN_LIMIT && !r.repeat_why) problems.push(`${label}: limit ${limit} is a repeat; say why in repeat_why (the last 5 hits held on-topic pages new to pages.yaml)`);
    for (const id of ranks) if (!rowKeys.has(String(id))) problems.push(`${label}: rank ${id} has no row in pages.yaml (every ranked page is recorded there once)`);
  }
  if (topics.size > MAX_TOPICS) problems.push(`sweep: ${topics.size} topics; group the subjects into at most ${MAX_TOPICS}`);
  if (atSweep && pages === undefined && records.some((r) => asList(r?.ranks).length || r?.via === "structure")) problems.push("pages.yaml is missing (the page store, needed from the sweep phase on)");
  if (atPlan) {
    const missing = [...sweepSubjects(units, sources)].filter((s) => !topicOf.has(s)).sort();
    if (missing.length && sweep === undefined) problems.push(`sweep.yaml is missing (needed from the plan phase on); subjects without a topic: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? ", …" : ""}`);
    else for (const s of missing) problems.push(`subject "${s}" is under no sweep topic (Step M3b: group every subject into a topic's subjects list)`);
  }
  return { problems, warnings };
}

/**
 * An archived page, and an updated page whose edit replaces or removes text (an update without `append_only: true`), must have its own content
 * accounted for from the plan stage on: an inventory row with that `page_id` and verdict `decomposed` (its units are then placed, link-only or dropped
 * with the human's decision like any source), or a decision of the human that names the page (`edits_pages: [id]`; `pages` belongs to a compare-conflict decision and never counts here). A page that keeps AI out (a `blocked`
 * row in pages.yaml) can't be decomposed, so only the decision counts. Plan rows alone never count.
 * @param {{plan: any[], sources: any[], rows: any[], state: any}} a The plan pages, inventory rows, page-store rows and state.
 * @returns {string[]} Problems.
 */
export function checkEditedPages({ plan, sources, rows, state }) {
  const out = [];
  const named = new Set(userDecisions(state).flatMap((d) => asList(d.edits_pages)).map(String));
  for (const p of plan) {
    const needs = p?.action === "archive" || (p?.action === "update" && p.append_only !== true);
    if (!needs || p.page_id == null) continue;
    const id = String(p.page_id);
    const what = p.action === "archive" ? "archives" : "replaces or removes text on";
    if (rows.some((r) => r?.id != null && String(r.id) === id && r.state === "blocked")) {
      if (!named.has(id)) out.push(`plan ${p.key}: ${what} page ${id}, which keeps AI out and can't be read; it needs a decision of the human that names it (edits_pages: [${id}])`);
      continue;
    }
    if (named.has(id)) continue;
    if (!sources.some((s) => isWikiSource(s) && String(s.page_id) === id && s.verdict === "decomposed")) {
      out.push(`plan ${p.key}: ${what} page ${id}, but its own content is not accounted for: add an inventory row with page_id ${id} (verdict decomposed, so its units are placed, linked or dropped with a decision), or record a decision of the human naming the page (edits_pages: [${id}]); an update that only adds text says append_only: true`);
    }
  }
  return out;
}

/**
 * Open questions must stand alone: the text says what is unclear in words (not a bare unit id), names its `source` and lists the `options`.
 * @param {any} state The parsed state.yaml.
 * @returns {{problems: string[], warnings: string[]}}
 */
export function checkQuestions(state) {
  const problems = [];
  const warnings = [];
  for (const q of asList(state?.open_questions)) {
    if (!q || typeof q !== "object") continue;
    const words = String(q.text ?? "").replace(/\bu\d{3,}\b/g, " ").split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
    if (words.length < 6) problems.push(`question ${q.id ?? "?"}: the text must say what is unclear in words (the unit's paraphrase, what is unclear), never only a unit id`);
    if (!q.source) warnings.push(`question ${q.id ?? "?"}: no source (the name of the file or page the unit comes from)`);
    if (!asList(q.options).length) warnings.push(`question ${q.id ?? "?"}: no options to choose from`);
  }
  return { problems, warnings };
}

/**
 * A yes to a question: every decision of the human that has `rows`, and every short decision (two words or fewer, "apply", "go", "ok") of any kind,
 * records the question it answers as `via_question`. That must be an entry of open_questions that named exactly the same rows (`rows`), or, for a
 * decision without rows, the same `subject` (the question's `subject`) or units. A longer decision without rows needs none.
 * @param {any} state The parsed state.yaml.
 * @returns {string[]} Problems.
 */
export function checkShortYes(state) {
  const out = [];
  const questions = new Map(asList(state?.open_questions).filter((q) => q?.id != null).map((q) => [String(q.id), q]));
  const key = (l) => asList(l).map(String).sort().join(",");
  for (const d of userDecisions(state)) {
    const rows = asList(d.rows);
    const short = d.text != null && String(d.text).trim().split(/\s+/).filter(Boolean).length <= 2;
    if (d.via_question == null) {
      if (rows.length) out.push(`decision ${d.id}: a yes to source rows needs via_question, the open question that named exactly these rows (rows: [${rows.join(", ")}]), however long the answer is`);
      else if (short) out.push(`decision ${d.id}: a short answer ("${d.text}") counts only as the yes to a question; record that question as via_question`);
      continue;
    }
    const q = questions.get(String(d.via_question));
    const editsPages = asList(d.edits_pages);
    if (short && !rows.length && d.subject == null && !asList(d.units).length && !editsPages.length) {
      out.push(`decision ${d.id}: a short answer ("${d.text}") must carry what it answers: rows, subject, units or edits_pages, matching the question ${d.via_question} named`);
    } else if (!q) {
      out.push(`decision ${d.id}: via_question ${d.via_question} is not in open_questions`);
    } else if (rows.length) {
      if (key(q.rows) !== key(rows)) out.push(`decision ${d.id}: rows [${rows.join(", ")}] differ from the rows question ${q.id} named ([${asList(q.rows).join(", ")}]); the yes covers exactly the rows asked`);
    } else if (d.subject != null) {
      if (String(q.subject ?? "") !== String(d.subject)) out.push(`decision ${d.id}: question ${q.id} is not about the subject "${d.subject}" (give the question a subject)`);
    } else if (asList(d.units).length) {
      if (key(q.units) !== key(d.units)) out.push(`decision ${d.id}: units [${asList(d.units).join(", ")}] differ from the units question ${q.id} named`);
    } else if (editsPages.length) {
      if (key(q.edits_pages) !== key(editsPages)) out.push(`decision ${d.id}: edits_pages [${editsPages.join(", ")}] differ from the edits_pages question ${q.id} named`);
    }
  }
  return out;
}

/**
 * Media (recordings of the decks) the plan links: with `policies.media.mode: link` each inventory row with `media: true` has a resolved `url`
 * (or `unresolved: <decision id>`), and each draft holds exactly the media urls its plan page lists in `media: [s12, ...]`, no other media row's url.
 * @param {{sources: any[], plan: any[], state: any, drafts: Record<string, string>, atDraft: boolean}} a The parsed files and phase flag.
 * @returns {string[]} Problems.
 */
export function checkMedia({ sources, plan, state, drafts, atDraft }) {
  const out = [];
  const mode = state?.policies?.media?.mode;
  const media = sources.filter((s) => s?.media === true);
  const byId = new Map(media.map((s) => [String(s.id), s]));
  const decided = new Set(userDecisions(state).map((d) => String(d.id)));
  if (mode === "link" && atDraft) {
    for (const s of media) if (!s.url && !(s.unresolved != null && decided.has(String(s.unresolved)))) out.push(`inventory ${s.id}: a recording to be linked has no url yet (resolve it through Microsoft 365 search by name, then the hit's ref); if it can't be found, ask the human and record unresolved: <decision id>`);
  }
  for (const p of plan) {
    if (!p?.key || !Array.isArray(p.media)) continue;
    const listed = p.media.map(String);
    for (const id of listed) if (!byId.has(id)) out.push(`plan ${p.key}: media ${id} is not an inventory row with media: true`);
    const md = drafts[p.key];
    if (md === undefined || !atDraft) continue;
    const links = new Set([...md.matchAll(/https?:\/\/[^\s)>\]"']+/gi)].map((m) => pathKey(m[0])));
    for (const s of media) {
      if (!s.url) continue;
      const here = links.has(pathKey(s.url));
      if (listed.includes(String(s.id)) && !here) out.push(`draft ${p.key}: the plan lists the recording ${s.id}, but its link is not in the draft`);
      if (!listed.includes(String(s.id)) && here) out.push(`draft ${p.key}: links the recording ${s.id}, which the plan does not list for this page (there is no such video on this page's deck)`);
    }
  }
  return out;
}

/** The files a job folder may hold. Anything else is a warning: notes go in state.yaml notes: / next:, raw output is not kept. */
export const LEDGER_FILES = ["state.yaml", "inventory.yaml", "sweep.yaml", "pages.yaml", "units.yaml", "plan.yaml", "drafts"];

/**
 * Warnings for files in the job folder that the ledger does not document.
 * @param {string[]} names The entries of the folder (hidden ones are ignored).
 * @returns {string[]}
 */
export function undocumentedFiles(names) {
  return names.filter((n) => !n.startsWith(".") && !LEDGER_FILES.includes(n)).sort().map((n) => `${n} is not a ledger file; the session's own notes go in state.yaml notes: and next:, and raw tool output is not kept in the job folder`);
}

// ------------------------------------------- source fates and the restructuring proposal (Step M9)

/** What the human can be proposed for a source. */
export const DISPOSITIONS = ["ready-to-delete", "move", "rename", "keep-linked", "edit", "leave"];

/** The fates a source can end with. The last four changed the source and need the human's decision for that row. */
export const FATES = ["kept-linked", "archived", "left", "deleted", "moved", "renamed", "edited"];

/** Which proposed disposition each executed fate may come from. */
const FATE_FROM = { deleted: ["ready-to-delete"], moved: ["move", "ready-to-delete"], renamed: ["rename"], edited: ["edit"] };

/**
 * Why a source may not be proposed as `ready-to-delete`; an empty list means every unit of it is accounted for.
 * A unit counts when it is placed on a published page, link-only to somewhere other than the source itself, or dropped (or secret) with the human's decision.
 * A `duplicate` row needs its `duplicate_of` row to exist and be eligible itself; an `empty` or no_knowledge row has no units to prove, which the table shows as unverified.
 * A dropped or secret unit needs a user decision that names its subject, the unit or this source row.
 * @param {any} src The inventory row.
 * @param {any[]} units All units.
 * @param {any} state The parsed state.yaml.
 * @param {any[]} [sources] All inventory rows (to follow `duplicate_of`).
 * @param {Set<string>} [seen] Rows already followed (cycle guard).
 * @returns {string[]} The reasons, empty when eligible.
 */
export function deleteBlockers(src, units, state, sources = [], seen = new Set()) {
  const out = [];
  const published = new Set(asList(state?.published).filter((e) => e?.plan && e.page_id != null).map((e) => String(e.plan)));
  if (isWikiSource(src)) out.push("a live wiki page is retired with an archive page in the plan, never deleted as a source");
  if (!["decomposed", "empty", "duplicate"].includes(src?.verdict)) out.push(`its verdict is ${src?.verdict ?? "none"}, so nothing proves its content is placed`);
  const mine = units.filter((u) => String(u?.source) === String(src?.id));
  if (src?.verdict === "decomposed" && !mine.length && !src.no_knowledge) out.push("it is decomposed but no unit names it");
  if (src?.verdict === "duplicate") {
    const orig = sources.find((x) => String(x?.id) === String(src.duplicate_of ?? ""));
    seen.add(String(src.id));
    if (!orig) out.push(`it is a duplicate but duplicate_of ${src.duplicate_of ?? "(missing)"} is not an inventory row`);
    else if (seen.has(String(orig.id))) out.push("its duplicate_of points back into a cycle");
    else for (const b of deleteBlockers(orig, units, state, sources, seen)) out.push(`its original ${orig.id}: ${b}`);
  }
  const own = new Set([src?.path, src?.url].filter(Boolean).map(pathKey));
  for (const u of mine) {
    const v = u.verdict ?? "pending";
    if (v === "keep" || v === "merge") {
      if (!published.has(String(u.target))) out.push(`unit ${u.id} is placed on ${u.target}, which is not published`);
    } else if (v === "link-only") {
      if (own.has(pathKey(u.link))) out.push(`unit ${u.id} is link-only to the source itself, so it lives only there`);
    } else if (v === "drop" || v === "out-of-scope" || v === "secret") {
      if (!hasNamedDecision(state, u, src?.id)) out.push(`unit ${u.id} is ${v} without a decision of the human that names its subject, the unit or this row (decision: <id>)`);
    } else out.push(`unit ${u.id} is ${v}`);
  }
  return out;
}

/**
 * Checks the proposed dispositions (the M9 table) and the executed fates of every source row.
 * A proposal needs a reason and, where content moves or is replaced, where it now lives; `ready-to-delete` is refused unless deleteBlockers is empty;
 * move and rename need new_path and the list of wiki links they break with the order that avoids it. An executed fate (deleted, moved, renamed, edited)
 * needs a decision of the human that names this row (rows: [..]), executed_at, version_checked equal to the inventory version (a changed source is
 * re-decomposed, not deleted), a matching proposal, a hard-delete decision for `deleted`, and a `_moved-to-wiki/<job>/` new_path for a delete that moved.
 * @param {any[]} sources The inventory rows.
 * @param {any[]} units All units.
 * @param {any} state The parsed state.yaml.
 * @returns {string[]} Problems.
 */
export function checkDispositions(sources, units, state) {
  const problems = [];
  const decided = new Map(userDecisions(state).map((d) => [String(d.id), d]));
  for (const s of sources) {
    const id = String(s?.id ?? "?");
    const d = s?.disposition;
    if (d != null) {
      if (!DISPOSITIONS.includes(d)) {
        problems.push(`inventory ${id}: disposition "${d}" is not one of ${DISPOSITIONS.join(", ")}`);
      } else {
        if (!s.disposition_reason) problems.push(`inventory ${id}: disposition ${d} needs disposition_reason`);
        if (d !== "leave" && !asList(s.lives_at).length) problems.push(`inventory ${id}: disposition ${d} needs lives_at, the wiki pages where its content now lives (or that link it)`);
        if (isRepoSource(s) && !GITHUB_DISPOSITIONS.includes(d)) problems.push(`inventory ${id}: a repository file may only be proposed ${GITHUB_DISPOSITIONS.join(", ")}, not ${d} (history and pins hang on the file)`);
        if (d === "ready-to-delete") for (const b of deleteBlockers(s, units, state, sources)) problems.push(`inventory ${id}: ready-to-delete refused: ${b}`);
        if (d === "move" || d === "rename") {
          if (isWikiSource(s)) problems.push(`inventory ${id}: a wiki page is moved or renamed with wiki-maintenance, not here`);
          if (!s.new_path) problems.push(`inventory ${id}: ${d} needs new_path (mirror the wiki structure, e.g. one folder per Area)`);
          else if (hasDotDot(s.new_path)) problems.push(`inventory ${id}: new_path "${s.new_path}" has a ".." segment`);
          if (!Array.isArray(s.breaks)) problems.push(`inventory ${id}: ${d} needs breaks, the wiki links the new path would break (an empty list when none)`);
          else if (s.breaks.length && !s.order) problems.push(`inventory ${id}: ${d} breaks ${s.breaks.length} wiki link(s); give the order that avoids it (order: move, then update the links with preview_edit and a yes)`);
        }
      }
    }
    const fate = s?.fate;
    if (fate == null) continue;
    if (!FATES.includes(fate)) {
      problems.push(`inventory ${id}: fate "${fate}" is not one of ${FATES.join(", ")}`);
      continue;
    }
    if (fate === "left" && !s.fate_reason) problems.push(`inventory ${id}: fate left needs fate_reason`);
    if (isRepoSource(s) && ["deleted", "moved", "renamed"].includes(fate)) {
      problems.push(`inventory ${id}: a repository file is never ${fate} by the skill (history and pins hang on it); only edited, kept-linked or left`);
      continue;
    }
    if (!FATE_FROM[fate]) continue;
    const dec = decided.get(String(s.decision ?? ""));
    if (!dec) problems.push(`inventory ${id}: fate ${fate} changed a source without the human's decision (decision: <id> with decided_by: user)`);
    else if (!asList(dec.rows).map(String).includes(id)) problems.push(`inventory ${id}: fate ${fate} rests on decision ${dec.id}, which does not name this row (rows: [${id}, …]); a yes to the plan or to publishing does not count`);
    if (!s.executed_at) problems.push(`inventory ${id}: fate ${fate} needs executed_at`);
    if (fate === "edited" && isRepoSource(s)) {
      const branch = String(s.branch ?? "").trim();
      if (!branch) problems.push(`inventory ${id}: an edit of a repository file goes on a new branch; record it as branch`);
      else if ([...DEFAULT_BRANCHES, s.default_branch].filter(Boolean).map((b) => String(b).trim().toLowerCase()).includes(branch.toLowerCase())) problems.push(`inventory ${id}: branch ${branch} is the default branch; an edit of a repository file goes on a new branch with a pull request, never on the default branch`);
      if (s.pr == null || ["", "0"].includes(String(s.pr).trim())) problems.push(`inventory ${id}: an edit of a repository file goes through a pull request the human merges; record it as pr (URL or number)`);
    }
    if (s.version_checked == null) problems.push(`inventory ${id}: fate ${fate} needs version_checked, the source's version read right before the action`);
    else if (String(s.version_checked) !== String(s.version)) problems.push(`inventory ${id}: the source is at ${s.version_checked}, the inventory says ${s.version}; it changed, so re-decompose it and do not ${fate === "deleted" ? "delete" : "change"} it`);
    if (!FATE_FROM[fate].includes(s.disposition)) problems.push(`inventory ${id}: fate ${fate} has no matching proposal (disposition ${s.disposition ?? "missing"}; expected ${FATE_FROM[fate].join(" or ")})`);
    if (fate === "deleted" && dec && dec.hard_delete !== true) problems.push(`inventory ${id}: a hard delete needs a decision with hard_delete: true; the default is to move it into _moved-to-wiki/${state?.job ?? "<job>"}/ (fate moved)`);
    if (fate === "moved" && s.disposition === "ready-to-delete") {
      const want = `_moved-to-wiki/${state?.job ?? ""}/`;
      const np = normPath(s.new_path);
      if (!state?.job || hasDotDot(s.new_path) || !np.startsWith(want) || np.length === want.length) {
        problems.push(`inventory ${id}: a delete is a move to a path that starts with _moved-to-wiki/${state?.job ?? "<job>"}/ (new_path, no ".." segment), recoverable`);
      }
    }
    if ((fate === "moved" || fate === "renamed") && s.new_path && hasDotDot(s.new_path)) problems.push(`inventory ${id}: new_path "${s.new_path}" has a ".." segment`);
    if ((fate === "moved" || fate === "renamed") && !s.new_path) problems.push(`inventory ${id}: fate ${fate} needs new_path`);
  }
  return problems;
}

/**
 * The source restructuring proposal as one table for the human, with each `ready-to-delete` row's eligibility.
 * @param {any[]} sources The inventory rows.
 * @param {any[]} units All units.
 * @param {any} state The parsed state.yaml.
 * @returns {string} Text, one row per source.
 */
export function dispositionTable(sources, units, state) {
  const rows = ["source | path | disposition | eligible | reason | lives at | breaks | order"];
  for (const s of sources) {
    const blockers = s?.disposition === "ready-to-delete" ? deleteBlockers(s, units, state, sources) : [];
    const hasUnits = units.some((u) => String(u?.source) === String(s?.id));
    const elig = s?.disposition === "ready-to-delete" ? (blockers.length ? `NO (${blockers.join("; ")})` : hasUnits ? "yes" : "yes, unverified (no units)") : "-";
    rows.push([s?.id, s?.path ?? s?.url ?? "", s?.disposition ?? "(none)", elig, s?.disposition_reason ?? "", asList(s?.lives_at).join(", "), asList(s?.breaks).join(", "), s?.order ?? ""].join(" | "));
  }
  return rows.join("\n");
}

/**
 * Checks the whole ledger. Pure: the caller reads the files.
 * @param {{state?: any, plan?: any, units?: any, inventory?: any, sweep?: any, pages?: any, extraFiles?: string[], drafts?: Record<string, string>}} files The parsed ledger files (undefined = the file is missing), the names of other files in the folder, and the draft texts by plan key.
 * @param {{close?: boolean, final?: boolean, hashOf?: (text: string) => string}} opts `close`: the end-of-job demands. `final`: any "ledger:" left in a draft fails. `hashOf`: sha256 of a draft, for state.verified.
 * @returns {{problems: string[], warnings: string[], counts: Record<string, number>, order: string[], cycles: string[]}}
 */
export function checkLedger(files, opts = {}) {
  const problems = [];
  const warnings = [];
  const state = files.state ?? {};
  const pages = asList(files.plan?.pages);
  const units = asList(files.units?.units);
  const sources = asList(files.inventory?.sources);
  const drafts = files.drafts ?? {};
  const phase = phaseIndex(state);
  const at = (name) => phase >= PHASES.indexOf(name);
  const atSweep = at("sweep");
  const atDraft = at("draft");
  const atVerify = at("verify");
  const decisions = decisionIds(state);

  if (!state.phase) problems.push("state.yaml: no phase");
  else if (phase < 0) problems.push(`state.yaml: phase "${state.phase}" is not one of ${PHASES.join(", ")}`);
  if (at("inventory") && files.inventory === undefined) problems.push("inventory.yaml is missing (needed from the inventory phase on)");
  if (at("decompose") && files.units === undefined) problems.push("units.yaml is missing (needed from the decompose phase on)");
  if (at("plan") && files.plan === undefined) problems.push("plan.yaml is missing (needed from the plan phase on)");

  // plan
  const planKeys = new Set();
  const planByKey = new Map();
  for (const p of pages) {
    const key = String(p?.key ?? "");
    if (!key) {
      problems.push("plan.yaml: a page has no key");
      continue;
    }
    if (planKeys.has(key)) problems.push(`plan.yaml: duplicate page key ${key}`);
    planKeys.add(key);
    planByKey.set(key, p);
    if (!["create", "update", "archive"].includes(p.action)) problems.push(`plan ${key}: action must be create, update or archive`);
    if (p.action === "update" && p.page_id == null) problems.push(`plan ${key}: an update needs the existing page_id`);
    if (p.action === "archive" && p.page_id == null) problems.push(`plan ${key}: an archive needs the existing page_id`);
    if (p.action === "create") {
      if (!p.title) problems.push(`plan ${key}: a new page needs a title`);
      if (!p.filing) problems.push(`plan ${key}: a new page needs its filing (book › chapter)`);
      if (!p.type) problems.push(`plan ${key}: a new page needs a type`);
    }
    if (p.action !== "archive" && at("plan")) {
      if (!p.audience) problems.push(`plan ${key}: no audience (who can read the target book)`);
      if (typeof p.restricted !== "boolean") problems.push(`plan ${key}: restricted must be true or false (is the target book restricted?)`);
    }
    for (const k of asList(p.links_to)) if (!pages.some((q) => q?.key === k)) problems.push(`plan ${key}: links_to ${k} is not a page of the plan`);
    if (p.template != null && (!Array.isArray(p.template) || !p.template.length || p.template.some((h) => typeof h !== "string" || !h.trim()) || new Set(p.template.map((h) => String(h).toLowerCase())).size !== p.template.length)) {
      problems.push(`plan ${key}: template must be a list of distinct, non-empty heading names (from get_wiki_structure templates)`);
    }
  }
  /** A message that is a warning before verify and a problem from verify on. */
  const soft = (msg) => (atVerify ? problems : warnings).push(msg);
  const { order, cycles } = publishOrder(pages.filter((p) => p?.key));
  if (cycles.length) warnings.push(`plan: pages ${cycles.join(", ")} link each other; publish them without those links and let the link pass add them`);

  // inventory
  const sourceIds = new Map();
  for (const s of sources) {
    const id = String(s?.id ?? "");
    if (!id) {
      problems.push("inventory.yaml: a source has no id");
      continue;
    }
    if (sourceIds.has(id)) problems.push(`inventory: duplicate source id ${id}`);
    sourceIds.set(id, s);
    if (!s.path && !s.url) problems.push(`inventory ${id}: no path or url`);
    if (!s.version) warnings.push(`inventory ${id}: no version recorded`);
    if (!s.verdict) problems.push(`inventory ${id}: no verdict`);
    else if (!SOURCE_VERDICTS.includes(s.verdict)) problems.push(`inventory ${id}: verdict "${s.verdict}" is not one of ${SOURCE_VERDICTS.join(", ")}`);
    else if (["empty", "duplicate", "irrelevant"].includes(s.verdict) && !s.reason) problems.push(`inventory ${id}: verdict ${s.verdict} needs a reason`);
    else if (s.verdict === "blocked" && !s.block_reason) problems.push(`inventory ${id}: a blocked source needs the block_reason the tool returned`);
    // a source the wiki already covers is decomposed and its units are link-only to the page; it is never skipped as irrelevant, empty or a duplicate of the page
    if (["irrelevant", "empty", "duplicate"].includes(s.verdict) && WIKI_COVERED_CLAIM.test(String(s.reason ?? ""))) problems.push(`inventory ${id}: verdict ${s.verdict} with the reason "${s.reason}" claims the wiki covers it; decompose it and make each unit link-only to the page that holds it (coverage is never judged from the page alone)`);
    if (s.verdict === "duplicate" && s.duplicate_of && !isWikiSource(s) && isWikiSource(sources.find((x) => String(x?.id) === String(s.duplicate_of)))) problems.push(`inventory ${id}: duplicate_of ${s.duplicate_of} is a wiki page; a file the wiki covers is decomposed, its units link-only to that page`);
    if (s.verdict === "duplicate" && !s.duplicate_of) warnings.push(`inventory ${id}: duplicate without duplicate_of`);
    if (s.state && !["current", "plan", "unknown"].includes(s.state)) problems.push(`inventory ${id}: state must be current, plan or unknown`);
    if (at("plan") && !s.state) problems.push(`inventory ${id}: current-or-planned state not asked (state: current | plan)`);
    if (at("plan") && s.verdict === "decomposed" && s.state === "unknown") problems.push(`inventory ${id}: state unknown; ask whether it describes the current state or a plan`);
    if (at("plan") && typeof s.restricted !== "boolean") problems.push(`inventory ${id}: restricted must be true or false (who can read this source?)`);
    if (at("plan") && s.kind == null && s.page_id == null) problems.push(`inventory ${id}: kind missing (where it lives: ${SOURCE_KINDS.join(", ")}); without it a live wiki page can't be told from a file`);
    if (s.kind != null && s.kind !== "github" && isRepoSource(s)) problems.push(`inventory ${id}: kind is ${s.kind}, but the row has a repo or a github.com URL; a repository file is kind github`);
    if (s.kind != null && !SOURCE_KINDS.includes(s.kind)) problems.push(`inventory ${id}: kind "${s.kind}" (where the source lives) is not one of ${SOURCE_KINDS.join(", ")}`);
    if (s.kind === "wiki" && s.page_id == null) problems.push(`inventory ${id}: a wiki source needs page_id (its version is the page revision)`);
    if (s.added_by != null && s.added_by !== "sweep") problems.push(`inventory ${id}: added_by must be "sweep" (a page the wiki sweep brought in)`);
  }

  // units
  const ids = new Set();
  const counts = { units: units.length, placed: 0, "link-only": 0, dropped: 0, secret: 0, pending: 0, blocked: sources.filter((s) => s?.verdict === "blocked").length };
  const unitById = new Map();
  for (const u of units) if (u?.id != null) unitById.set(String(u.id), u);
  const numbers = [];
  for (const u of units) {
    const id = String(u?.id ?? "");
    if (!id) {
      problems.push("units.yaml: a unit has no id");
      continue;
    }
    if (ids.has(id)) problems.push(`unit ${id}: duplicate id`);
    ids.add(id);
    const n = /^u(\d+)$/.exec(id);
    if (n) numbers.push(Number(n[1]));

    const src = sourceIds.get(String(u.source));
    if (!u.source) problems.push(`unit ${id}: no source`);
    else if (sourceIds.size && !src && u.origin !== "human") problems.push(`unit ${id}: source ${u.source} is not in inventory.yaml`);
    else if (src?.verdict && src.verdict !== "decomposed") problems.push(`unit ${id}: its source ${u.source} is ${src.verdict}, which never produces units`);
    if (!u.version) problems.push(`unit ${id}: no source version`);
    if (!UNIT_KINDS.includes(u.kind)) problems.push(`unit ${id}: kind "${u.kind ?? ""}" is not one of ${UNIT_KINDS.join(", ")}`);
    if (!u.subject) problems.push(`unit ${id}: no subject`);
    if (!u.text) problems.push(`unit ${id}: no text`);
    else for (const hit of secretHits(String(u.text))) problems.push(`unit ${id}: text matches the secret pattern ${hit}; record that a secret exists, never its value`);
    if (!["read", "inferred", "human"].includes(u.origin)) problems.push(`unit ${id}: origin must be read, inferred or human`);
    if (!["current", "plan"].includes(u.state)) problems.push(`unit ${id}: state must be current or plan (copied from its source)`);
    else if (src?.state && ["current", "plan"].includes(src.state) && src.state !== u.state) problems.push(`unit ${id}: state ${u.state} differs from its source ${u.source} (${src.state})`);

    const v = u.verdict ?? "pending";
    if (!u.verdict) problems.push(`unit ${id}: no verdict (write "pending" if it is not decided yet)`);
    else if (!UNIT_VERDICTS.includes(v)) problems.push(`unit ${id}: verdict "${v}" is not one of ${UNIT_VERDICTS.join(", ")}`);

    if (Array.isArray(u.target)) problems.push(`unit ${id}: more than one target (a unit lands on one page)`);
    const placed = v === "keep" || v === "merge";
    if (placed) {
      if (u.target == null || u.target === "") problems.push(`unit ${id}: verdict ${v} without a target page`);
      else if (!Array.isArray(u.target) && !planKeys.has(String(u.target))) problems.push(`unit ${id}: target ${u.target} is not a page of plan.yaml`);
      else if (planByKey.get(String(u.target))?.action === "archive") problems.push(`unit ${id}: target ${u.target} is a page to be archived; a unit can't land on it`);
      if (v === "merge") {
        const into = unitById.get(String(u.merged_into ?? ""));
        if (!into) problems.push(`unit ${id}: merge needs merged_into, the id of the unit it is folded into`);
        else if (into.verdict !== "keep") problems.push(`unit ${id}: merged_into ${u.merged_into} must be a kept unit (it is ${into.verdict ?? "pending"})`);
        else if (String(into.target) !== String(u.target)) problems.push(`unit ${id}: merged into ${u.merged_into}, which sits on page ${into.target}, not ${u.target}`);
      }
      if (src?.restricted === true) {
        const page = planByKey.get(String(u.target));
        if (page && page.restricted !== true) problems.push(`unit ${id}: comes from restricted source ${u.source} but is placed on page ${u.target} in an open book`);
      }
      if (u.state === "plan" && !decisions.has(String(u.decision ?? ""))) {
        problems.push(`unit ${id}: describes a plan, not the current state; place it only with a recorded decision (decision: <id>) that says it is shown as planned, otherwise drop it`);
      }
      if (u.needs_ok === true && !decisions.has(String(u.confirmed ?? ""))) problems.push(`unit ${id}: touches a "needs my ok" policy (needs_ok); place it only once the human confirmed it (confirmed: <decision id>)`);
      if (u.origin === "inferred" && !decisions.has(String(u.confirmed ?? ""))) problems.push(`unit ${id}: inferred, not read; place it only once the human confirmed it (confirmed: <decision id>)`);
    } else if (u.target != null && u.target !== "") {
      problems.push(`unit ${id}: verdict ${v} but it has a target (${u.target})`);
    }
    if (v === "link-only" && !u.link) problems.push(`unit ${id}: link-only needs link, where the source stays`);
    if (v === "link-only" && /\/books\/[^/\s]+\/page\/[^/\s#?]+/i.test(String(u.link ?? ""))) problems.push(`unit ${id}: link-only to a full wiki page URL (${u.link}); use /link/<page id>; the script can only match a page by id (slugs change on rename and move)`);
    if (v === "drop" && WIKI_COVERED_CLAIM.test(String(u.reason ?? ""))) problems.push(`unit ${id}: dropped with the reason "${u.reason}", which says the wiki already holds it; that is link-only to the page, a drop is for what the wiki must not keep`);
    // "the page holds it" is only known after the page was decomposed too, so its units sit in the ledger and are compared
    if (v === "link-only" && at("plan") && !isWikiSource(src)) {
      const lid = wikiLinkId(u.link);
      const known = new Set([...sources.filter(isWikiSource).map((x) => String(x.page_id ?? "")), ...asList(state.published).map((e) => String(e?.page_id ?? ""))]);
      const compared = asList(files.pages?.pages).some((r) => r?.id != null && String(r.id) === lid && /^covered/.test(String(r.compared?.[id] ?? "")));
      if (lid != null && !known.has(lid) && !compared) problems.push(`unit ${id}: link-only to wiki page ${lid}, which is neither an inventory row nor a compared page that covers this unit; compare it with the units first (pages.yaml compared: {${id}: covered#<section>}) so its value is checked, never assume it`);
    }
    if ((v === "drop" || v === "out-of-scope") && !u.reason) problems.push(`unit ${id}: ${v} needs a reason`);
    if ((v === "drop" || v === "out-of-scope") && isWikiSource(src) && !hasNamedDecision(state, u)) {
      problems.push(`unit ${id}: comes from the live wiki page ${src.page_id ?? src.path}; dropping it needs the human's decision that names its subject or lists it (decision: <id>, decided_by: user, subject: ${u.subject} or units: [${id}])`);
    }
    if (v === "secret" && !u.reason) problems.push(`unit ${id}: a secret unit needs reason (where it goes instead; never its value)`);
    if (u.kind === "secret" && v !== "secret") problems.push(`unit ${id}: kind secret must have verdict secret, never ${v}`);
    if (u.kind === "risk" && placed && !decisions.has(String(u.decision ?? ""))) {
      problems.push(`unit ${id}: a risk unit is kept only with the human's decision (decision: <id> in state.yaml)`);
    }
    if (u.superseded_by != null) {
      const by = unitById.get(String(u.superseded_by));
      if (!by) problems.push(`unit ${id}: superseded_by ${u.superseded_by} is not a unit`);
      else if (String(u.superseded_by) === id) problems.push(`unit ${id}: superseded by itself`);
      else if (!isPlacedUnit(by)) problems.push(`unit ${id}: superseded_by ${u.superseded_by}, which is not placed on a page (${by.verdict ?? "pending"})`);
      if (v !== "drop") problems.push(`unit ${id}: a superseded unit has verdict drop`);
    }

    if (placed) counts.placed++;
    else if (v === "link-only") counts["link-only"]++;
    else if (v === "drop" || v === "out-of-scope") counts.dropped++;
    else if (v === "secret") counts.secret++;
    else counts.pending++;
  }
  // A drop with a live sibling of the same subject (placed, or link-only: its fact stays where it links, e.g. a page the wiki already has) needs the human's decision.
  const placedSubjects = new Set(units.filter((u) => (isPlacedUnit(u) || isWikiHeldUnit(u)) && u.subject).map((u) => String(u.subject)));
  for (const u of units) {
    if (u?.verdict === "drop" && u.subject && placedSubjects.has(String(u.subject)) && !hasNamedDecision(state, u)) {
      problems.push(`unit ${u.id}: dropped although a unit of subject "${u.subject}" is placed or link-only to a wiki page; record the human's decision about that subject (decision: <id>, decided_by: user, subject: ${u.subject})`);
    }
  }
  // Units are append-only: a hole in the numbering means a line was removed.
  const maxNumber = numbers.length ? Math.max(...numbers) : 0;
  if (numbers.length) {
    const have = new Set(numbers);
    const missing = [];
    for (let i = 1; i <= maxNumber; i++) if (!have.has(i)) missing.push(i);
    if (missing.length) problems.push(`units.yaml: ids missing from the sequence (a unit was deleted?): ${missing.slice(0, 10).map((i) => `u${String(i).padStart(3, "0")}`).join(", ")}${missing.length > 10 ? ", …" : ""}`);
  }
  // state.counts.units and state.counts.max_unit_id are written at every append, so a deleted last unit shows.
  if (at("decompose")) {
    if (state.counts?.units == null) problems.push("state.yaml: counts.units is missing (update it at every append to units.yaml)");
    else if (Number(state.counts.units) !== counts.units) problems.push(`counts: state.yaml says ${state.counts.units} units, units.yaml holds ${counts.units}`);
    if (state.counts?.max_unit_id == null) problems.push("state.yaml: counts.max_unit_id is missing (the highest unit number; update it at every append)");
    else if (Number(state.counts.max_unit_id) !== maxNumber) problems.push(`counts: state.yaml says the highest unit is ${state.counts.max_unit_id}, units.yaml ends at ${maxNumber}`);
  }
  const bucketSum = counts.placed + counts["link-only"] + counts.dropped + counts.secret + counts.pending;
  if (bucketSum !== counts.units) problems.push(`counts: ${counts.units} units but the buckets add up to ${bucketSum}`);
  if (counts.pending) (atVerify ? problems : warnings).push(`${counts.pending} units are still pending${atVerify ? " (every unit needs a verdict before verify)" : ""}`);
  for (const s of sources) {
    if (s?.verdict === "decomposed" && !s.no_knowledge && !units.some((u) => String(u?.source) === String(s.id))) {
      (at("plan") ? problems : warnings).push(`inventory ${s.id}: decomposed but no unit names it as source (mark it no_knowledge: "<reason>" if it holds none)`);
    }
  }

  // the intake answers (Step M1), the searches and the page store (Step M3b), questions, and the source proposal / fates (Step M9)
  if (at("decompose")) problems.push(...checkPolicies(state));
  const sw = checkSweep({ units, sources, sweep: files.sweep, pages: files.pages, atSweep, atPlan: at("plan") });
  problems.push(...sw.problems);
  warnings.push(...sw.warnings);
  if (atSweep || files.pages !== undefined) {
    const pg = checkPages({ rows: asList(files.pages?.pages), units, plan: pages, state, atPlan: at("plan"), atDraft, atPublish: at("publish") });
    problems.push(...pg.problems);
    warnings.push(...pg.warnings);
  }
  if (at("plan")) problems.push(...checkEditedPages({ plan: pages, sources, rows: asList(files.pages?.pages), state }));
  const qs = checkQuestions(state);
  problems.push(...qs.problems);
  warnings.push(...qs.warnings);
  problems.push(...checkShortYes(state));
  problems.push(...checkMedia({ sources, plan: pages, state, drafts, atDraft }));
  warnings.push(...undocumentedFiles(asList(files.extraFiles)));
  if (state.next != null && typeof state.next !== "string") problems.push("state.yaml: next must be one string (where to continue after a compaction or a usage-limit stop)");
  if (state.notes != null && !Array.isArray(state.notes)) problems.push("state.yaml: notes must be a list");
  const rowIds = new Set(sources.map((s) => String(s?.id)));
  for (const d of userDecisions(state)) for (const r of asList(d.rows)) if (!rowIds.has(String(r))) problems.push(`decision ${d.id}: rows names ${r}, which is not in the inventory`);
  if (at("publish")) problems.push(...checkDispositions(sources, units, state));
  for (const d of asList(state.decisions)) {
    if (d && typeof d === "object" && d.decided_by !== "user") warnings.push(`decision ${d.id ?? "?"}: no decided_by: user, so it does not count (Claude may suggest, only the human decides)`);
  }

  // reconcile: units of one subject that differ need a recorded decision
  for (const [subject, group] of conflictGroups(units)) {
    // merged duplicates need no decision: exempt only when every unit folds into one kept unit of the group
    const roots = new Set(group.map((u) => String(u.verdict === "merge" ? u.merged_into : u.id)));
    // ...and only when the merged text is the root's text: a merge may not hide a different value
    const root = group.find((u) => roots.has(String(u.id)));
    if (roots.size === 1 && root && group.every((u) => u === root || norm(u.text) === norm(root.text))) continue;
    if (userDecisions(state).some((d) => String(d?.subject) === String(subject))) continue;
    const msg = `subject "${subject}": ${group.map((u) => u.id).join(", ")} differ and no decision in state.yaml names this subject`;
    (atDraft ? problems : warnings).push(msg);
  }

  // drafts
  const publishedKeys = new Set(asList(state.published).filter((e) => e?.plan && e.page_id != null).map((e) => String(e.plan)));
  const skippedKeys = new Set(asList(state.skipped).filter((e) => e?.plan && e.reason).map((e) => String(e.plan)));
  for (const p of pages) {
    if (!p?.key || p.action === "archive") continue;
    const md = drafts[p.key];
    if (md === undefined) {
      if (atVerify && phase < PHASES.indexOf("close") && !publishedKeys.has(String(p.key)) && !skippedKeys.has(String(p.key))) problems.push(`plan ${p.key}: no draft file (drafts/${p.key}.md)`);
      continue;
    }
    problems.push(...checkDraft(p.key, md, planKeys, { final: opts.final }));
    if (Array.isArray(p.template) && p.template.length && !p.template.some((h) => typeof h !== "string")) {
      for (const m of checkTemplate(p.key, md, p.template)) soft(m);
    }
  }
  // pages with no template list: the lead copies the headings into plan.yaml at Step M4
  for (const p of pages) {
    if (!p?.key || p.action === "archive" || p.template != null) continue;
    if (p.action === "create") soft(`plan ${p.key}: no template list (write the headings of its type's template, plus the also: section, from get_wiki_structure into plan.yaml)`);
    else if (atDraft) warnings.push(`note: plan ${p.key} is an update with no template list, so its headings are not checked (list the headings the edit writes to check them)`);
  }

  // type against content, and the Areas' overview pages
  const mixedOk = new Set(userDecisions(state).map((d) => String(d?.mixed ?? "")).filter(Boolean));
  for (const p of pages) {
    if (!p?.key || p.action === "archive") continue;
    const placed = units.filter((u) => isPlacedUnit(u) && String(u.target) === String(p.key));
    const r = checkPageType(p, placed, mixedOk);
    r.soft.forEach(soft);
    warnings.push(...r.warn);
  }
  checkOverviews(pages, state).forEach(soft);

  // publish: ids of published pages
  const published = new Map();
  for (const e of asList(state.published)) {
    if (!e?.plan || e.page_id == null) {
      problems.push("state.yaml: a published entry needs plan and page_id");
      continue;
    }
    if (!planKeys.has(String(e.plan))) problems.push(`state.yaml: published ${e.plan} is not a page of plan.yaml`);
    published.set(String(e.plan), e.page_id);
  }
  const skipped = new Map();
  for (const e of asList(state.skipped)) {
    if (!e?.plan || !e.reason) problems.push("state.yaml: a skipped entry needs plan and reason");
    else skipped.set(String(e.plan), e.reason);
  }
  // changesets: one entry per preview_changeset / apply_changeset run (migrate-publish.md), so a later session can resume it.
  const changesets = asList(state.changesets);
  for (const c of changesets) {
    if (!c?.run_id && c?.status !== "previewed") problems.push("state.yaml: a changesets entry needs run_id (from the apply result) unless its status is previewed");
    if (!CHANGESET_STATUSES.includes(c?.status)) problems.push(`state.yaml: changesets ${c?.run_id ?? "?"}: status must be one of ${CHANGESET_STATUSES.join(", ")}`);
    for (const k of asList(c?.plan)) if (!planKeys.has(String(k))) problems.push(`state.yaml: changesets ${c?.run_id ?? "?"} names plan page ${k}, which is not a page of plan.yaml`);
  }
  // From the publish phase on, a draft that is not published yet must be the one that passed verify (script and coverage).
  if (opts.hashOf && at("publish")) {
    const verified = new Map(asList(state.verified).map((e) => [String(e?.plan ?? ""), String(e?.sha256 ?? "")]));
    for (const p of pages) {
      if (!p?.key || p.action === "archive" || published.has(String(p.key)) || skipped.has(String(p.key)) || drafts[p.key] === undefined) continue;
      const want = verified.get(String(p.key));
      if (!want) problems.push(`plan ${p.key}: no state.verified entry; verify this page (script and coverage), then record its sha256 (--hashes)`);
      else if (want !== opts.hashOf(drafts[p.key])) problems.push(`plan ${p.key}: the draft changed after it was verified; verify it again (Step M7), then update state.verified`);
    }
  }

  // retire last: archiving a page can save new revisions of the pages that link it, which refuses their approved previews
  if (at("publish")) {
    for (const p of pages) {
      if (p?.action !== "archive" || !published.has(String(p.key))) continue;
      const open = pages.filter((q) => q?.key && q.action !== "archive" && !published.has(String(q.key)) && !skipped.has(String(q.key)));
      if (open.length) problems.push(`plan ${p.key}: archived before ${open.map((q) => q.key).join(", ")} was edited; edit the pages that link a page first and archive it last`);
    }
  }

  if (opts.close) {
    if (counts.pending) problems.push(`close: ${counts.pending} units are still pending`);
    for (const s of sources) {
      if (s?.verdict === "pending") problems.push(`close: source ${s.id} has no verdict`);
      if (!FATES.includes(s?.fate)) problems.push(`close: source ${s?.id} has no fate (${FATES.join(", ")})`);
      if (s?.fate === "kept-linked" && !s.fate_link) problems.push(`close: source ${s.id} is kept but names no wiki page that links it (fate_link)`);
    }
    for (const p of pages) {
      if (p?.key && p.action !== "archive" && !published.has(String(p.key)) && !skipped.has(String(p.key))) {
        problems.push(`close: page ${p.key} is not published (no published entry with its id) and not skipped (a skipped entry with a reason)`);
      }
    }
    for (const c of changesets) if (c?.status !== "applied") problems.push(`close: changeset ${c?.run_id ?? "(not applied)"} is ${c?.status ?? "without a status"}: resume it (preview_changeset with resume) or record why it was dropped`);
    for (const q of asList(state.open_questions)) if (q?.status !== "answered") problems.push(`close: question ${q?.id ?? "?"} is still open`);
    if (!opts.final) warnings.push("close: run with --final too, so leftover ledger: links fail");
  }

  return { problems, warnings, counts, order: [...order.filter((k) => planByKey.get(k)?.action !== "archive"), ...order.filter((k) => planByKey.get(k)?.action === "archive")], cycles };
}

/**
 * Wiki page id a link points at (`/link/508`, `/link/508#section`, a wiki URL ending in `/link/508`), or null for any other link.
 * @param {any} link A unit's `link`.
 * @returns {string|null}
 */
export function wikiLinkId(link) {
  const m = /(?:^|\/)link\/(\d+)(?:#\S*)?\s*$/.exec(String(link ?? "").trim());
  return m ? m[1] : null;
}

/**
 * Whether a link-only unit stands for a fact that lives on a wiki page: its link is a wiki page link and its kind is not
 * changelog or todo (those are dropped or linked as history, never a value the wiki holds). Only such units are live in conflicts.
 * @param {any} u A unit.
 * @returns {boolean}
 */
export function isWikiHeldUnit(u) {
  return u?.verdict === "link-only" && wikiLinkId(u.link) != null && !["changelog", "todo"].includes(u.kind);
}

/** A reason that claims the wiki already covers a source: coverage is shown by link-only units after decomposing, never by a source verdict or a drop reason. */
const WIKI_COVERED_CLAIM = /\b(already|covered|documented|described|contained|captured|same as|duplicated?)\b[^.;]{0,40}\b(wiki|page\s*#?\d+|\/link\/\d+)|\b(wiki|page\s*#?\d+)\b[^.;]{0,40}\b(already|covers?|covered|holds|has (it|this|all))\b/i;

/**
 * Groups of live units (kept, merged, link-only or still pending, not superseded) of one subject whose texts differ.
 * A link-only unit is live only when it stands for a fact held on a wiki page (isWikiHeldUnit): a different value elsewhere is then a conflict; a changelog or todo unit, or one linking a repository or a file, is not.
 * @param {any[]} units All units.
 * @returns {Map<string, any[]>} Subject → its units, differing groups only.
 */
export function conflictGroups(units) {
  const bySubject = new Map();
  for (const u of units) {
    if (!u?.subject || !(["keep", "merge", "pending"].includes(u.verdict ?? "pending") || isWikiHeldUnit(u)) || u.superseded_by != null) continue;
    bySubject.set(String(u.subject), [...(bySubject.get(String(u.subject)) ?? []), u]);
  }
  for (const [subject, group] of [...bySubject]) {
    if (group.length < 2 || new Set(group.map((u) => norm(u.text))).size < 2) bySubject.delete(subject);
  }
  return bySubject;
}

/**
 * The `--conflicts` view: the differing groups with both texts, and for a unit from a live wiki page that page's revision and last-reviewed date,
 * so the human sees a newer source against an older wiki page side by side.
 * @param {any[]} units All units.
 * @param {any[]} sources The inventory rows.
 * @returns {string}
 */
export function conflictsView(units, sources) {
  const groups = conflictGroups(units);
  if (!groups.size) return "no conflicts";
  const byId = new Map(sources.map((s) => [String(s?.id), s]));
  const out = [];
  for (const [subject, group] of groups) {
    out.push(`${subject}:`);
    for (const u of group) {
      const src = byId.get(String(u.source));
      const wiki = isWikiSource(src) ? ` [live wiki page ${src.page_id ?? src.path}, ${src.version ?? "no revision"}, last-reviewed ${src.last_reviewed ?? "unknown"}]` : "";
      out.push(`  - ${u.id} | ${u.source} (${u.version}, ${u.state})${wiki} | ${u.verdict ?? "pending"} | ${u.text}`);
    }
  }
  return out.join("\n");
}

/**
 * The text the coverage agent gets for one page: the units mapped to it, and the known excluded ones (never a secret's text).
 * @param {string} key The plan page's key.
 * @param {any[]} units All units.
 * @param {any[]} [media] The inventory rows (`media: true`) the plan page lists in `media`; printed as PLANNED MEDIA so the checker can compare the page's links.
 * @returns {string}
 */
export function unitsFor(key, units, media = []) {
  const mine = units.filter((u) => isPlacedUnit(u) && String(u.target) === key);
  const sources = new Set(mine.map((u) => String(u.source)));
  const lines = ["UNITS (keep or merge, on this page):"];
  for (const u of mine) {
    const flags = [`origin ${u.origin}`, `state ${u.state}`];
    if (u.origin === "inferred" && u.confirmed) flags.push(`confirmed ${u.confirmed}`);
    if (u.verdict === "merge") flags.push(`merged into ${u.merged_into}`);
    lines.push(`- ${u.id} | ${u.kind} | ${u.subject} | ${flags.join(", ")} | ${u.text}`);
  }
  lines.push("", "KNOWN EXCLUDED (left out on purpose; the page must not state them):");
  const excluded = units.filter((u) => ["link-only", "drop", "out-of-scope", "secret"].includes(u.verdict) && sources.has(String(u.source)));
  for (const u of excluded) lines.push(`- ${u.id} | ${u.subject} | ${u.verdict}${u.verdict !== "secret" && u.reason ? ` (${u.reason})` : ""}`);
  if (!excluded.length) lines.push("- (none)");
  if (media.length) {
    lines.push("", "PLANNED MEDIA (the recordings this page links, no more and no fewer; name | url):");
    for (const m of media) lines.push(`- ${m.id} | ${String(m.path ?? m.title ?? "").split("/").pop()} | ${m.url ?? "(no url yet)"}`);
  }
  return lines.join("\n");
}

/**
 * Every subject with its units' ids, verdicts and targets, so the lead can normalise subjects without reading units.yaml.
 * @param {any[]} units All units.
 * @returns {string}
 */
export function subjectsList(units) {
  const bySubject = new Map();
  for (const u of units) if (u?.subject) bySubject.set(String(u.subject), [...(bySubject.get(String(u.subject)) ?? []), u]);
  return [...bySubject].sort(([a], [b]) => a.localeCompare(b)).map(([s, g]) => `${s}: ${g.map((u) => `${u.id}(${u.verdict ?? "pending"}${u.target ? `>${u.target}` : ""})`).join(" ")}`).join("\n");
}

// ------------------------------------------------------------------------- CLI

/**
 * Reads a ledger file as the YAML subset.
 * @param {string} dir The job folder.
 * @param {string} name File name.
 * @param {boolean} required Whether a missing file is an error.
 * @returns {unknown} The parsed value, or undefined when missing and not required.
 */
function readLedgerFile(dir, name, required) {
  const path = join(dir, name);
  if (!existsSync(path)) {
    if (required) throw new Error(`${name} is missing in ${dir}`);
    return undefined;
  }
  try {
    return parseYaml(readFileSync(path, "utf8")) ?? {};
  } catch (err) {
    throw new Error(`${name}: ${err.message}`);
  }
}

/**
 * Resolves a job folder: the real path (a symlink into a repository is a path into that repository), which must exist and lie outside every git work tree.
 * @param {string} arg The folder as given.
 * @returns {string} The resolved path.
 */
export function resolveJobDir(arg) {
  const dir = existsSync(arg) ? realpathSync(resolve(arg)) : resolve(arg);
  if (!existsSync(dir)) throw new Error(`${dir} does not exist`);
  const git = spawnSync("git", ["-C", dir, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
  if (git.status === 0 && git.stdout.trim() === "true") throw new Error(`${dir} is inside a git work tree; the ledger holds source text and must live outside every repository (~/.leviwiki/migrate/<job>/)`);
  return dir;
}

/**
 * Reads every ledger file of a job folder (a missing optional file is undefined), the drafts by plan key and the names of other files in the folder.
 * @param {string} arg The job folder as given.
 * @returns {{dir: string, state: any, plan: any, units: any, inventory: any, sweep: any, pages: any, drafts: Record<string, string>, extraFiles: string[]}}
 */
export function loadJob(arg) {
  const dir = resolveJobDir(arg);
  const state = readLedgerFile(dir, "state.yaml", true);
  const plan = readLedgerFile(dir, "plan.yaml", false);
  const units = readLedgerFile(dir, "units.yaml", false);
  const inventory = readLedgerFile(dir, "inventory.yaml", false);
  const sweep = readLedgerFile(dir, "sweep.yaml", false);
  const pages = readLedgerFile(dir, "pages.yaml", false);
  const drafts = {};
  for (const p of asList(plan?.pages)) {
    const path = join(dir, p?.draft ?? `drafts/${p?.key}.md`);
    if (p?.key && existsSync(path)) drafts[p.key] = readFileSync(path, "utf8");
  }
  return { dir, state, plan, units, inventory, sweep, pages, drafts, extraFiles: readdirSync(dir) };
}

/** The flags without a value, and the ones that take one. */
const BOOL_FLAGS = ["--close", "--final", "--order", "--json", "--conflicts", "--subjects", "--hashes", "--dispositions", "--known", "--layers"];
const VALUE_FLAGS = ["--units-for"];

/**
 * Runs the check on a job folder.
 * @param {string[]} argv The command line without node and the script.
 * @returns {number} The exit code.
 */
export function main(argv) {
  const flags = new Set();
  const values = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (VALUE_FLAGS.includes(a)) values[a] = argv[++i];
    else if (a.startsWith("--")) flags.add(a);
    else rest.push(a);
  }
  const unknown = [...flags].filter((f) => !BOOL_FLAGS.includes(f));
  const missing = VALUE_FLAGS.filter((f) => f in values && !values[f]);
  if (rest.length !== 1 || unknown.length || missing.length) {
    console.error(`usage: check-ledger.mjs <job dir> [${BOOL_FLAGS.join("] [")}] [--units-for <page key>]`);
    return 2;
  }
  try {
    const job = loadJob(rest[0]);
    const { dir, state, plan, units, inventory, sweep, pages, drafts } = job;
    const unitList = asList(units?.units);
    const hashOf = (text) => createHash("sha256").update(text).digest("hex");

    // Views for the lead, so it never reads all of units.yaml.
    if (flags.has("--subjects")) return console.log(subjectsList(unitList) || "(no units)"), 0;
    if (flags.has("--conflicts")) {
      console.log(conflictsView(unitList, asList(inventory?.sources)));
      return 0;
    }
    if (flags.has("--dispositions")) {
      const rows = asList(inventory?.sources);
      console.log(dispositionTable(rows, unitList, state));
      const refused = checkDispositions(rows, unitList, state);
      for (const p of refused) console.log(`PROBLEM  ${p}`);
      console.log(refused.length ? `${refused.length} problem(s): the proposal is refused` : "ok");
      return refused.length ? 1 : 0;
    }
    if (values["--units-for"]) {
      if (!asList(plan?.pages).some((p) => p?.key === values["--units-for"])) throw new Error(`${values["--units-for"]} is not a page of plan.yaml`);
      const page = asList(plan?.pages).find((p) => p?.key === values["--units-for"]);
      const planned = asList(page?.media).map(String);
      console.log(unitsFor(values["--units-for"], unitList, asList(inventory?.sources).filter((x) => planned.includes(String(x?.id)))));
      return 0;
    }
    if (flags.has("--known")) {
      console.log(JSON.stringify(knownPages(asList(pages?.pages))));
      return 0;
    }
    if (flags.has("--hashes")) {
      for (const [key, md] of Object.entries(drafts)) console.log(`${key} ${hashOf(md)}`);
      return 0;
    }
    if (flags.has("--layers")) {
      const batches = changesetBatches(asList(plan?.pages), (k) => (drafts[k] ?? "").length);
      if (!batches.changesets.length) console.log("(no pages to write)");
      batches.changesets.forEach((c, i) => console.log(`changeset ${i + 1} of ${batches.changesets.length}: ${c.keys.join(" ")}  (${c.creates} creates, ${c.edits} edits, ${c.chars} characters)`));
      if (batches.cycles.length) console.log(`in a cycle: ${batches.cycles.join(", ")}: write them without their links to each other${batches.fixups.length ? `, then one more changeset of edits adds those links (${batches.fixups.join(", ")})` : ""}`);
      return 0;
    }

    const report = checkLedger({ state, plan, units, inventory, sweep, pages, extraFiles: job.extraFiles, drafts }, { close: flags.has("--close"), final: flags.has("--final"), hashOf });
    // The folder holds source text: no access for group or others (POSIX only).
    if (process.platform !== "win32" && (statSync(dir).mode & 0o077) !== 0) {
      report.problems.push(`${dir} is accessible to others (mode ${(statSync(dir).mode & 0o777).toString(8)}); run chmod 700 on it`);
    }
    if (flags.has("--json")) console.log(JSON.stringify(report, null, 2));
    else {
      const c = report.counts;
      console.log(`units ${c.units} = placed ${c.placed} + link-only ${c["link-only"]} + dropped ${c.dropped} + secret ${c.secret} + pending ${c.pending}; blocked sources ${c.blocked}`);
      for (const p of report.problems) console.log(`PROBLEM  ${p}`);
      for (const w of report.warnings) console.log(`warning  ${w}`);
      if (flags.has("--order")) console.log(`publish order: ${report.order.join(" -> ") || "(none)"}${report.cycles.length ? `; in a cycle: ${report.cycles.join(", ")}` : ""}`);
      console.log(report.problems.length ? `${report.problems.length} problem(s)` : "ok");
    }
    return report.problems.length ? 1 : 0;
  } catch (err) {
    console.error(err.message);
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
