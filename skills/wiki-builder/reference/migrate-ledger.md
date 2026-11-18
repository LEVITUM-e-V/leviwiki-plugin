# The ledger

Read this at Step M1 (creating the files) and whenever you write to one. **Write through `scripts/ledger.mjs`**
(below), not by editing the YAML: it appends or updates and checks in one step.
The job folder is `~/.leviwiki/migrate/<job>/`, outside every git repository, mode 700;
it holds source text, so it is treated like the sources: restricted, `no-ai`
and secret-scan material never goes in (a blocked source is a row with its
reason, nothing more).

```
~/.leviwiki/migrate/<job>/
  state.yaml      small, reread at every step: phase, decisions, published ids, open questions
  inventory.yaml  one row per source item
  sweep.yaml      the searches of the wiki sweep (Step M3b): one record per topic and way of searching, with the ranked page ids
  pages.yaml      the page store: one row per wiki page or OneDrive file the job looked at, what is known about it
  units.yaml      the knowledge units, append-only
  plan.yaml       the target pages
  drafts/<key>.md one draft per plan page (key = the plan page's key)
```

**Format.** A small YAML subset so the script can read it without a library:
block maps and lists, one-line values, `[a, b]` and `{k: v}` on one line.
Quote every string that holds `: ` or ` #` or that looks like a number or a
commit sha made of digits. No multi-line strings (`|`, `>`), no anchors, no
tabs. One unit per list item; **append to `units.yaml`, never edit or delete
a line** (a unit that was wrong gets `drop` with a reason, or is superseded).
Ids: sources `s01`…, units `u001`…, plan pages `p1`…, decisions `d1`…, questions `q1`…, sweeps `sw1`….
**No other file lives in the job folder** (`check-ledger.mjs` warns about one): the session's own notes go in `state.yaml` `notes:`, where to continue after a compaction or a usage-limit stop in `next:`; raw tool output is not kept.

## state.yaml

```yaml
job: flight-ops-sharepoint
phase: draft          # scope inventory decompose sweep plan reconcile draft verify publish close
started: 2026-11-16
scope:
  areas: [powertrain, avionics]
  note: "SharePoint Flight/ops folder, 14 files, user wants P5 material only"
policies:             # the intake answers of Step M1, asked in one batch; every key is needed from phase decompose on. Each: the human's words + decided_by: user, or the string "asked: not applicable"
  scope: {text: "the whole folder", decided_by: user, date: 2026-11-16}
  currency: {text: "the 2024 decks are old, the 2026 ones current", decided_by: user, date: 2026-11-16}
  needs_ok: {text: "general knowledge is free; P5 facts need my ok", decided_by: user, date: 2026-11-16}
  media: {text: "match each recording to its deck and link it", mode: link, decided_by: user, date: 2026-11-16}   # mode: link | decompose | ignore
  third_party: {text: "vendor documents stay on SharePoint", decided_by: user, date: 2026-11-16}
  outside_docs: "asked: not applicable"
  archived: {text: "archived pages may be edited", decided_by: user, date: 2026-11-16}
  reorganisations: "asked: not applicable"
  out_of_scope: {text: "Planner tasks and flight logs are out", decided_by: user, date: 2026-11-16}
notes:                # the session's own notes (ledger.mjs note "...")
  - {date: 2026-11-16, text: "the 2023 deck is the German one"}
next: "decompose s05-s09, then the sweep"   # where to continue after a compaction (ledger.mjs note --next "...")
counts:               # mandatory from decompose on; update both at EVERY append to units.yaml
  units: 9
  max_unit_id: 9
decisions:             # only an entry with decided_by: user counts; Claude may suggest, never choose (it writes the human's answer, not its own pick)
  - {id: d1, subject: p5-battery, text: "Datasheet value wins over the 2025 slide: 6S 16000 mAh (measured 15.2 Ah)", decided_by: user, date: 2026-11-16}
  - {id: d2, text: "RDP rule from README kept out of the wiki (opens 3389 to every network)", decided_by: user, date: 2026-11-16}
  - {id: d3, text: "Human confirmed: the 8 A charge current follows from 0.5 C of 16 Ah", decided_by: user, date: 2026-11-16}
  # optional fields: mixed: <plan key> (that page may mix method and data), skip_overview: <Area> (no overview edit for that Area),
  # units: [u004] (the units a drop decision is about, besides its `subject`), rows: [s01, s03] (the source rows a fate applies to; each must be in the inventory),
  # via_question: q4 (the open question this yes answers: needed for EVERY decision that has `rows`, whatever its length, and for every short decision (two words or fewer) of any kind; the question must have named exactly those rows, or have the same `subject`),
  # edits_pages: [9003] (the human decided those wiki pages may be archived or rewritten without being decomposed; `pages` is for a compare-conflict decision (subject + pages) and does not count here: an archive or a text-replacing update of a page needs either an inventory row for it or such a decision; a page that keeps AI out only the decision),
  # declines_mentions: [9004] (the human declined to edit those wiki pages although a unit answers, outdates or links them: settles that page's `answers` / `stale` / `link` mentions in pages.yaml),
  # hard_delete: true (the human asked for a real delete), e.g. {id: d4, text: "...", mixed: p2, decided_by: user, date: 2026-11-16}
overview:             # Area -> page id of its overview page (or none); the lead fills it at Step M4 (get_wiki_structure / search_wiki)
  Powertrain: 410
verified:             # from publish on: sha256 of each unpublished draft that passed verify (check-ledger.mjs --hashes)
  - {plan: p1, sha256: "<64 hex characters>"}
skipped:              # a plan page deliberately not published, with the reason
  - {plan: p9, reason: "human dropped this page at the preview"}
published:
  - {plan: p1, page_id: 612}
changesets:           # one entry per preview_changeset / apply_changeset (migrate-publish.md); a later session resumes a stopped one with its run_id
  - {run_id: 20261117-143210-changeset-a1b2, status: applied, plan: [p1, p2]}   # status: previewed (no run_id yet), applied, stopped, dropped; --close needs every entry applied
reviews:              # from publish on, one entry per unpublished plan page (ledger.mjs add-review with the sha256 of the bundle; the agents' results, see migrate-coverage.md)
  - {plan: p1, coverage: ok, cold: ok, at: 2026-11-17, sha256: "<64 hex characters>"}   # coverage: ok | findings; cold: ok | findings | skipped (a new page over 40 lines needs ok or findings); sha256 = the draft that was reviewed
open_questions:       # a question stands alone: the unit's paraphrase (never source text), its source's name, what is unclear, the options; never a bare unit id
  - {id: q1, text: "The Flight/ops notes say the cycle counter can be reset by anyone, the safety page says only stewards (u031 and u044): who may reset it?", source: "SharePoint/Flight/ops-notes.docx", options: ["anyone", "stewards only"], status: open}
  - {id: q2, text: "Move the two duplicate decks s05 and s06 into _moved-to-wiki/flight-ops-sharepoint/ on SharePoint?", source: "SharePoint/Flight", rows: [s05, s06], options: ["apply", "leave"], status: open}
```

A question that asks for a yes on source rows lists them in `rows` (a question about one subject says its `subject`). The human's answer, short ("apply", "go") or long, is recorded as a decision with the same `rows` (or `subject`), `text` their words and `via_question: <the question id>`: the yes covers exactly the rows the question named (the script compares the lists). A decision with `rows` without it, and any decision of two words or fewer without it, fails.

## inventory.yaml

```yaml
sources:
  - {id: s01, kind: sharepoint, path: "SharePoint/Flight/P5 powertrain.docx", version: "modified 2026-10-01", state: current, verdict: decomposed, restricted: false}
  - {id: s02, kind: sharepoint, path: "SharePoint/Flight/notes-old.docx", version: "modified 2025-03-02", state: current, verdict: empty, reason: "only a title", restricted: false}
  - {id: s03, kind: github, repo: "org/example-params", path: "README.md", url: "https://github.com/org/example-params/blob/4bd3cc8/README.md", version: "4bd3cc8", state: plan, verdict: decomposed, restricted: false}
  - {id: s04, kind: wiki, page_id: 9001, path: "wiki page 9001", version: "revision 14", state: current, verdict: blocked, block_reason: "secret-scan", restricted: false}
  - {id: s05, kind: sharepoint, path: "SharePoint/Flight/P5 powertrain (copy).docx", version: "modified 2026-09-20", state: current, verdict: decomposed, restricted: false}
  - {id: s06, kind: wiki, page_id: 9002, path: "wiki page 9002", version: "revision 14", last_reviewed: 2026-05-01, added_by: sweep, state: current, verdict: decomposed, restricted: false}
  - {id: s07, kind: sharepoint, path: "SharePoint/Flight/P5 powertrain.mp4", version: "modified 2026-10-02", state: current, verdict: irrelevant, reason: "a recording of s01's deck; linked, not decomposed", restricted: false, media: true, media_of: s01, url: "https://example.sharepoint.com/sites/x/P5-powertrain.mp4"}
```

Verdicts: `decomposed` (its units are in units.yaml), `empty`, `duplicate`
(with `duplicate_of`), `irrelevant` (each needs `reason`), `blocked` (needs
`block_reason` as the tool returned it), `pending`. `state`: `current`, `plan` or
`unknown` (asked at Step M1). `kind` says where a source lives: `wiki`
(needs `page_id`; `version` is the revision; `last_reviewed` shown at conflicts),
`onedrive`, `sharepoint`, `github` (a recording or deck to be linked: `media: true`, `media_of: <deck row>` and, when the media policy says `link`, its resolved SharePoint `url` before drafting, or `unresolved: <decision id>` when the human decided it can't be found; a plan page lists its recordings in `media: [s07]`) (also `repo: owner/repo` and `path`; `version` is the commit sha it was read at), `local` (the reader's own `kind`, doc/deck/sheet…, is not
recorded here, or as `format`). `added_by: sweep` marks a page the wiki sweep brought in (Step M3b). A OneDrive or SharePoint row's `url` is the `webUrl` of the search or read result that found it, **never built from a folder path pattern**; a draft links the file with that url, and the script warns about a SharePoint link that matches no row's `url`.
At the end each source also gets a `fate` (below).

### Source fates and the restructuring proposal (Step M9)

Proposal (the table the human sees): `disposition` (`ready-to-delete`, `move`, `rename`,
`keep-linked`, `edit`, `leave`), `disposition_reason`, `lives_at: [/link/9002, …]` (wiki pages
where its content now lives, or that link it; not needed for `leave`), and for `move` / `rename`
`new_path`, `breaks: [/link/9, …]` (wiki links the new path breaks; `[]` if none) and `order`
("move, then preview_edit page 9 and 12 with a yes"). `ready-to-delete` is accepted only when every
unit of the source is placed on a **published** page, link-only to somewhere other than the source
itself, or dropped / secret with a user decision (`check-ledger.mjs <job> --dispositions` says which
and refuses the rest). A live wiki page is never a row for delete, move or rename. A `duplicate` row is deletable only when its `duplicate_of` row exists and is itself eligible; an `empty` or no_knowledge row has no units to prove and is shown as "unverified (no units)". A dropped or secret unit counts only with a user decision that names its subject, the unit or the row. Paths are compared normalised (no `./`, no double slash); `..` is refused. The proposal and fates are checked from phase `publish` on; `kind` is required on every row from `plan` on.

A `kind: github` row may only be proposed `edit`, `keep-linked` or `leave`: `ready-to-delete`, `move` and
`rename` are refused (history and pins hang on the file), and a fate of `deleted`, `moved` or `renamed`
on it is a problem. Its `edited` fate also needs `branch` and `pr` (a new branch and a pull request the human merges).

Fate, written **after** the action: `kept-linked` (with `fate_link`), `archived`, `left`
(with `fate_reason`), or one that changed the source: `deleted` (a hard delete, only with a
decision that has `hard_delete: true`), `moved` (also what "delete" means by default: its `new_path`
starts with `_moved-to-wiki/<job>/`, no `..`), `renamed`, `edited`. Each of these four needs `decision` (a user
decision whose `rows` names this source), `executed_at`, `version_checked` (the version read right
before acting; it must equal `version`, else re-decompose and do not act) and a matching proposal.

Example (not a ledger file):

```yaml
  - {id: s05, path: "SharePoint/Flight/P5 powertrain (copy).docx", version: "modified 2026-09-20", disposition: ready-to-delete, disposition_reason: "duplicate of s01, all units merged", lives_at: ["/link/612"], fate: moved, new_path: "_moved-to-wiki/flight-ops-sharepoint/Flight/P5 powertrain (copy).docx", decision: d7, executed_at: 2026-11-20, version_checked: "modified 2026-09-20"}
```
with `{id: d7, rows: [s05], text: "Move s05 to _moved-to-wiki", decided_by: user}` in `state.yaml`.

## sweep.yaml

```yaml
sweeps:
  - {id: sw1, topic: p5-battery, subjects: [p5-battery, p5-charge-current], via: structure, books: [357], listed: 41, outcome: "41 titles listed; 3 candidates"}
  - {id: sw2, topic: p5-charge, subjects: [p5-charge], via: sweep_wiki, queries: ["How to charge the P5 battery pack", "Akku laden P5"], limit: 20, returned: 4, ranks: [77, 31, 9002, "b!x:01BA"], outcome: "77 mentions it (back-link); 9002 is on topic and compared"}
  - {id: sw3, topic: p5-params, subjects: [p5-params], via: sweep_wiki, queries: ["P5 flight parameters PX4"], limit: 20, returned: 0, ranks: [], outcome: "no page on the topic"}
  - {id: sw4, topic: p5-rdp, subjects: [p5-rdp], via: sweep_wiki, queries: ["ground station remote desktop"], limit: 20, returned: 0, ranks: [], outcome: "no page on the topic"}
```

Step M3b writes it: **at most 15 topics**, each unit `subject` listed under one topic's `subjects` (a topic named by the human at M1 may have no subjects). **A topic is a group of subjects, not a query**: the record's `topic` is the group's name, and each topic may have 2-3 queries (`queries`, the sweep_wiki `key`s are `<topic>-1`, `<topic>-2`…); the 15 counts distinct `topic` values in the file. One record per topic and way of searching: `via: structure` (the books or chapters listed with `list_pages`, or one `search_wiki` per book when that tool is missing; `books` or `chapters`, `listed`) or `via: sweep_wiki` / `search_wiki` (`queries`, `limit` 20 at least, `returned` = the number of ranks, `ranks` = the ranked page ids, wiki pages by id, OneDrive files by `ref`). **Every ranked page has a row in `pages.yaml`**: what each page is and how it was judged lives there once, not in the record. A repeat at `limit: 50` is only made when the last 5 hits held on-topic pages that are new to the store, and says so in `repeat_why`. A `sweep_wiki` result with `degraded` (the search service was down: keyword hits only, no `revision_count`) is recorded with `degraded: true`; a query named in `errors` is retried once with `search_wiki`, and one that still fails is recorded as `failed: [{query, message}]`. `sweep_wiki` returns no GitHub hits: repository files come from one unscoped `search_wiki` per topic, recorded as `via: search_wiki` with GitHub ranks `owner/repo:path`. The old per-hit lists (`hits`) are not read.

## pages.yaml

The page store: **the job's one source of what is known about each wiki page or OneDrive file it looked at.**

```yaml
pages:
  - {id: 9002, title: "Charging P5", book_id: 357, chapter_id: 383, revision: 14, updated_at: "2026-05-01T10:00:00Z", seen_by: [list_pages, sweep_wiki], state: compared, headings: ["Steps", "Limits"], digest: "How the P5 pack is charged: rate, stop voltage, balance charge.", topics: [p5-charge], compared: {u003: "covered#steps", u008: new}, revision_rechecked: 14}
  - {id: 77, title: "Hardware overview", book_id: 357, revision: 21, seen_by: [sweep_wiki], best_rank: 1, state: digested, headings: ["Parts"], digest: "Lists the P5 parts, mentions the battery in one line.", topics: [], mentions: [], compare: skipped, compare_reason: "names the P5 battery in one line, states none of the job's units"}
  - {id: 31, title: "Team calendar", revision: 4, seen_by: [sweep_wiki], best_rank: 2, state: triaged-out, triage_why: "meeting dates, no hardware"}
  - {id: 504, title: "ADR: PX4 instead of ArduPilot", book_id: 357, revision: 2, seen_by: [list_pages], state: triaged-out}
  - {id: 700, title: "Finance overview", seen_by: [list_pages], state: blocked, block_reason: "no-ai"}
  - {ref: "b!x:01BA", kind: onedrive, title: "P5 charger CAD", lastModified: "2026-08-02", seen_by: [sweep_wiki], state: listed}
```

`title` is `list_pages`' `name` (a search hit's `title`); `revision` is `revision_count`. A GitHub file found by that `search_wiki` has `ref: "owner/repo:path"`, `kind: github` and is ranked in `sweep.yaml` as that same `repo:path` string. `state`: `listed` (a title from `list_pages` or a search, nothing judged), `candidate` (triage says it may be on topic), `triaged-out` (off topic; a bare title is enough, `triage_why` only when it was a top-5 hit, with `best_rank`), `digested` (a reader opened it once: `headings` and a 3-5 line `digest`, never page text), `compared` (its matching sections were compared with the job's units: `compared` maps a unit id to `covered` or `covered#<section>` (the section anchor, for the link), `partly`, `new` or `conflict`), `blocked` (a `no-ai` or secret-scan page: metadata only, no headings or digest, `block_reason` in the tool's words). `topics` are the job topics the page matches after it was digested; empty means off topic. A OneDrive file has `ref` (`driveId:itemId`) instead of `id`.

Rules: a page is opened with `get_page` only when it has no row or its `revision` (the `revision_count` of `list_pages` and search results) changed; every later topic is judged from the row; sections are re-read only for a compare. `known` for `sweep_wiki` is `check-ledger.mjs <job> --known` (the ids triaged-out, digested or compared). `declined: <decision id>` on a row records that the human declined a page that would otherwise have to be compared. Before publishing, each page an `update` or `archive` plan page edits gets `revision_rechecked` (the revision read right then); a value different from `revision` means the page changed since it was digested: read it again, update the row, preview again. **A row without `revision`** (a keyword-only result carries none: `sweep_wiki` with `degraded`, or the keyword fallback of `search_wiki`) can't show drift, so the page is re-read with `get_page` and the row gets `revision_rechecked` and `reread: get_page`; if it changed, compare its units again. `blocked` rows are also in `known`.

**`mentions`.** The reader that digests a page already has the job's unit list (units exist from M3) and records, per digested row, where the page touches a unit: `mentions: [{unit: u012, kind: contradicts, quote: "a PDB is part of the P5 harness"}]`, `[]` when it touches none. `kind`: `answers` (the page has an open question the unit settles), `contradicts` (the page says the opposite), `stale` (the page's statement is outdated by the unit), `link` (the page only needs a link to where the unit lives); `quote` is a short quote of the page (a mention is the one place a quote of page text is kept). **From `plan` on** every `digested` row has the field, and: a `contradicts` mention is settled by a decision of the human (`units: [u012]`, or `subject` + `pages: [9004]`; required from `draft`) or is an open question in `state.yaml` with `status: open` (`units: [u012]` or `subject` + `pages`; enough at `plan`; an answered question does not settle it, its answer must be a decision), so it reaches the human as a standalone question (Step M5); an `answers`, `stale` or `link` mention of a unit that is placed on a page (`keep` or `merge`) needs a plan page with `action: update` and that `page_id` (an `archive` row does not settle it), or a decision with `declines_mentions: [9004]`; a page the plan edits (any `page_id` in plan.yaml) is not `declined` and is `compared` or has at least one mention. **The agent decides itself which digested pages need no unit-by-unit compare**: it records `compare: skipped` with `compare_reason` once the mentions are written, and the human is not asked. On a row with `topics`, the reason has at least 6 words that say why no unit of the job is on the page; a placeholder (`n/a`, `none`, `-`, `tbd`) is refused. `mentions: []` stays legal. `declined: <decision id>` stays for a page the human declined on their own.

**An archived page, and an update that replaces or removes text, has its own content accounted for** (from `plan` on): an inventory row with its `page_id` and verdict `decomposed` (its units placed, link-only or dropped with the human's decision, as for any source), or a decision of the human naming it (`edits_pages: [id]`); a page that keeps AI out (`blocked`) needs the decision. An update that only adds text or links says `append_only: true` on its plan page. Plan rows alone never count, and a unit link-only to a page the plan merely updates passes only if the page was compared and covers the unit.

## units.yaml

```yaml
units:
  - {id: u001, source: s01, version: "modified 2026-10-01", state: current, kind: data, subject: p5-battery, text: "P5 battery pack: 6S, 16000 mAh nominal", origin: read, verdict: keep, target: p1}
  - {id: u002, source: s05, version: "modified 2026-09-20", state: current, kind: data, subject: p5-battery, text: "P5 battery pack: 6S, 14000 mAh nominal", origin: read, verdict: drop, reason: "superseded by d1", decision: d1, superseded_by: u001}
  - {id: u003, source: s01, version: "modified 2026-10-01", state: current, kind: procedure, subject: p5-charge, text: "Charging P5's pack: charge at 0.5 C (8 A); stop at 25.2 V; balance charge only", origin: read, verdict: keep, target: p2}
  - {id: u004, source: s03, version: "4bd3cc8", state: plan, kind: data, subject: p5-params, text: "P5 flight parameters live in example-params at commit 4bd3cc8", origin: read, verdict: link-only, link: "https://github.com/org/example-params/tree/4bd3cc8"}
  - {id: u005, source: s03, version: "4bd3cc8", state: plan, kind: risk, subject: p5-rdp, text: "Ground station: ufw allow 3389/tcp (RDP open to every network)", origin: read, verdict: drop, reason: "insecure, human decided d2"}
  - {id: u006, source: s01, version: "modified 2026-10-01", state: current, kind: changelog, subject: p5-pr, text: "Merged PR 212, bumped px4-firmware", origin: read, verdict: drop, reason: "changelog, belongs to the repository"}
  - {id: u007, source: s01, version: "modified 2026-10-01", state: current, kind: secret, subject: p5-gs-login, text: "Ground station login exists (value not recorded)", origin: read, verdict: secret, reason: "goes to the password manager; page links it"}
  - {id: u008, source: s01, version: "modified 2026-10-01", state: current, kind: method, subject: p5-charge-current, text: "Charging P5's pack: 8 A is 0.5 C of 16 Ah", origin: inferred, confirmed: d3, verdict: keep, target: p2}
  - {id: u009, source: s06, version: "revision 14", state: current, kind: procedure, subject: p5-charge, text: "Charging P5's pack: charge at 0.5 C (8 A); stop at 25.2 V; balance charge only", origin: read, verdict: merge, target: p2, merged_into: u003}
```

Fields: `state` is copied from the source row (`current` or `plan`).
`origin`: `read` (the source says it), `inferred` (concluded) or `human` (the
human's answer, appended as a unit, `source: human`). `verdict` is one of `keep`
(on a page, `target` = plan key), `merge` (folded into a **kept** unit on the
same page: `target` and `merged_into`), `link-only` (stays at the source, `link`
says where; a wiki page as `/link/<page id>`, never a `/books/<slug>/page/<slug>` URL: slugs change, the script matches by id and refuses it), `drop` and `out-of-scope` (each needs `reason`), `secret` (never
placed; `reason` says where it goes), `pending` (only until Step M4; from verify
on a pending unit is a problem). A unit has at most one `target`, never an
archive page; a unit with `superseded_by` is `drop` and points to a placed unit.
`kind: secret` never has another verdict. `decision: <id>` (into `state.yaml`
decisions, `decided_by: user`) is needed to place a `risk` unit, to place a `state: plan` unit (the
decision says it is shown as planned), to drop a unit whose subject has a
placed sibling and **to drop a unit that comes from a live wiki page**. A placed `origin: inferred` unit needs `confirmed: <id>`. Never
write a secret's value into `text` (the script scans it with the wiki's
secret-scan patterns). Append a unit, then update `counts.units` and
`counts.max_unit_id` in `state.yaml` in the same step.

## plan.yaml

```yaml
pages:
  - key: p1
    action: create                 # create | update | archive
    title: "P5 battery pack"
    filing: "Projects › P5 › Powertrain"
    type: reference
    template: ["At-a-glance table", "Detail", "Source & asset links", "Related"]   # headings of the type's template (get_wiki_structure templates)
    tags: [subsystem:powertrain, validation:researched]
    audience: "all members (Projects book, open)"   # who can read the target book
    restricted: false              # true: the target book is restricted
    links_to: [p2]                 # other NEW pages this one links (for the order)
    media: [s07]                   # optional: the recordings (inventory rows with media: true) this page links; the draft holds exactly these links
    units: [u001]                  # optional, derived from the units' target
  - key: p2
    action: update
    page_id: 9002                   # existing page
    filing: "Areas › Powertrain › Charging"
    audience: "all members (Powertrain Area, open)"
    restricted: false
    title: "Charging P5"
    type: task
    template: ["Steps"]            # an update: only the headings the edit writes
    units: [u003]
  - key: p3
    action: update
    page_id: 410                   # the Powertrain Area's overview page (state.yaml overview)
    overview_of: Powertrain
    append_only: true              # the edit only adds links; an update without it replaces or removes text and needs the page's own content accounted for
    filing: "Areas › Powertrain"
    audience: "all members (Powertrain Area, open)"
    restricted: false
    title: "Powertrain — overview"
    type: concept
    template: ["Related"]
    links_to: [p1]
```

**Page type and template fields** (Step M4, from `get_wiki_structure`, never from memory):
`type` is the primary type; `also: [task]` the secondary ones (`concept`, `task`,
`reference`, never `note`); `form` names a note's template variant (`adr`, `log`),
omitted otherwise. `template` is the list of that template's headings in its
order, followed by the `also:` type's `alsoSection` (put where it reads best, normally
before **Related**), e.g. `["Goal", "Prerequisites", "Steps", "Expected result", "Troubleshooting", "Why it matters", "Related"]`
for a task that is also a concept. For an `update` page, `template` lists only
the headings the edit writes (an update without it is not checked, with a note).
`filing` is `Shelf › Book › Chapter`; a page whose shelf is `Areas` is in that Area
(its book). `overview_of: <Area>` marks the plan page that edits (update) or
creates (when `state.overview` says `none`) that Area's overview page.

`audience` and `restricted` are asked at Step M1 and shown in the plan table: a
unit from a `restricted: true` source can only go on a page with
`restricted: true`. `links_to` lists only links to pages of this plan; it drives the publish
order. Draft links: `ledger:<key>` (a page of this plan, before it has an
id), `/link/<id>` (an existing or published page), absolute URLs.

## The script

`node <skill dir>/scripts/check-ledger.mjs ~/.leviwiki/migrate/<job> [--close] [--final] [--order]`.
It checks: the folder is outside git (symlinks resolved) and mode 700; the
files exist for the phase (units from decompose, plan from plan); counts
(units = placed + link-only + dropped + secret + pending; blocked sources
apart; `counts.units` and `counts.max_unit_id` in `state.yaml` match, ids have
no hole, so a deleted unit, even the last, shows); **from phase `decompose` on every intake answer is in `policies` (the human's words, or "asked: not applicable"); from phase `sweep` on every sweep record has a topic, a `via`, an outcome, `queries`, `limit` of at least 20 (a repeat needs `repeat_why`) and `returned` equal to its `ranks`, every ranked page has a `pages.yaml` row, and a `pages.yaml` row has id or ref, title, a valid state, headings and a digest when digested, metadata only when blocked, and a `triage_why` when triaged out of a top-5 hit; from `plan` on every unit subject is under a topic (at most 15), a candidate is digested, a digested page on a job topic is compared or declined, and a unit compared `conflict` has the human's decision from `draft` on; a link-only unit to a wiki page is an inventory row or a compared page that `covered`s it; a recording the media policy links has its `url` and a plan page's draft holds exactly the listed recordings; at publish each edited page was re-read (`revision_rechecked`) and an archive comes after the edits; questions say what is unclear in words; a short yes covers exactly the rows its question named; only a
decision with `decided_by: user` counts anywhere; dropping a unit of a live wiki page needs one;
a `ready-to-delete` proposal is refused unless every unit is accounted for, and a fate that
changed a source needs the human's decision for that row, `executed_at` and a `version_checked`
equal to the inventory version;** every unit has a verdict,
one target in the plan, its companion fields; state, restricted, inferred,
risk, plan, merge and supersede rules of the fields above; no secret pattern in
a unit or draft; units differing within one subject have a decision (an error
from `draft` on; a `link-only` unit whose `link` is a wiki page (`/link/<id>`, not changelog or todo) counts as live, so a source value against the page a
covered job links is a conflict too, and dropping a unit next to a placed or such a link-only one
of its subject needs the human's decision; such a link-only unit's page must be an inventory row (`page_id`) from `plan` on; `irrelevant`, `empty` and `duplicate` rows and drop reasons that say the wiki covers it, and a duplicate of a wiki row, are refused: decompose and link-only instead); a decomposed source with no unit needs `no_knowledge`;
pending units are an error from `verify` on; **from `plan` on every digested page has `mentions` and each is handled (above), a page the plan edits is compared or has mentions; from `publish` on every unpublished plan page has a `reviews` entry for the draft as it is now (coverage; cold read too for a new page over 40 lines)**; a SharePoint link in a draft that matches no inventory `url` is a warning (links come from a search or read result's `webUrl`, never from a folder path); the content-structure rules below; drafts are not empty, hold no
placeholder outside code (`TODO`, `TBD`, "to be determined", "coming soon",
`draft:<key>`, `{{…}}`, case-insensitive; a code sample may keep one); **a `TODO` line carried over from an existing page becomes `Open question: …`**, the check stays, links
resolve, no "Table 2" or "the table below" without the table; from `publish` on
an unpublished draft must match its sha256 in `state.verified`.
`--close`: nothing pending, every source has a fate (`kept-linked`, `archived`, `left`, `deleted`, `moved`, `renamed`, `edited`), every plan page is in
`published` or in `skipped` (with a reason), every question answered. `--final`:
no `ledger:` anywhere in a draft. Views, so the lead never reads units.yaml:
`--subjects`, `--conflicts` (a wiki source shows its revision and last-reviewed), `--units-for <page key>` (the coverage agent's
input), `--bundle <page key>` (**one block for an agent prompt**: the plan row, the draft and the page's units with verdict and target; the agents have no file tools and cannot read `drafts/`; with `--cold` only title, filing, type, template headings and the draft, for the cold reader), a closing `SHA256:` line (the hash of the draft the agent saw; it goes back into `add-review`), `--hashes` (the sha256 of each draft), `--known` (the page ids already judged, for `sweep_wiki`), `--dispositions` (the M9 proposal table with each row's eligibility; exit 1 refuses it). Exit 0 clean, 1 problems, 2
broken ledger. It ships with the plugin; the Desktop zip carries only Markdown,
so:

### Writing the ledger: `scripts/ledger.mjs`

`node <skill dir>/scripts/ledger.mjs ~/.leviwiki/migrate/<job> <command> ...` writes the ledger so no session edits YAML by hand (hand edits with string tools broke `units.yaml` in a pilot run). It reads the files with the same YAML subset as the checker, applies one change in memory, runs the whole check on the result and **writes only when the change adds no problem** (exit 1 lists them, nothing is written). Input is `--json '<value>'`, `--yaml '<text>'` (the reader's flow lines as they come), `--file <path>` or `--stdin`.

| Command | Does |
|---|---|
| `init` | **M1, first call:** creates the job folder (mode 700, `drafts/` 700, both chmod'ed: `mkdir -p -m 700 job/drafts` left the job folder at 755) and empty `state` / `inventory` / `units` / `plan` / `sweep` / `pages` files (mode 600) with their top-level keys; refuses a folder that holds any ledger file or any other file (only a new or empty folder is chmod'ed) and one inside a git work tree |
| `add-source <input>` | appends inventory rows (`s01`… assigned, verdict `pending` unless given); a source may be `pending` while its units are added (until the plan) |
| `set-source-verdict <id> <verdict> [--reason …] [--block-reason …] [--duplicate-of <id>] [--no-knowledge …]` | sets a source's verdict and its companion fields |
| `set-unit-verdict <id> <verdict> [--target <plan key>] [--link <url>] [--reason …] [--decision <id>] [--merged-into <unit>] [--superseded-by <unit>] [--confirmed <id>]` | changes a unit's verdict in place (the one change to a unit line: text, source and id never change); the old verdict's target, link, reason and pointers are cleared, `decision` and `confirmed` stay; the whole check runs on the result |
| `add-review <input>` | records `{plan, coverage: ok\|findings, cold?: ok\|findings\|skipped, sha256}` (the `SHA256:` line of the bundle the agent got; refused when the draft is different now) in `state.yaml` `reviews` with today's date, replacing an earlier entry of that page |
| `add-units <input>` | appends units: ids `u001`… assigned, `version`/`state` taken from the source row (the source may still be `pending`), verdict `pending` unless given, `counts` in `state.yaml` updated in the same step; creates the `units:` header of an empty or header-less file, and refuses (exit 1, nothing written) when the result would not read back as the old units plus the new ones; refuses a bad kind, a secret pattern, an unknown source |
| `add-decision <input>` | appends a decision (`text` is the human's own words; `decided_by: user`, id and date are added) |
| `set-policy <key> <input>` or `--na` | records an intake answer (`text`, optional `mode`) or "asked: not applicable" |
| `set-fate <source id> <input>` | sets the proposal and fate fields of an inventory row (only those); input flat (`{fate: left, fate_reason: …}`) or wrapped (`{fate: {…}}`); the checks of Step M9 apply |
| `add-sweep <input>` | appends sweep records (`sw1`… assigned) |
| `upsert-page <input>` | adds or updates `pages.yaml` rows by `id` or `ref` (`compared` merged per unit, `seen_by` united; `mentions`, `compare`, `compare_reason` replace) |
| `set-phase <phase>` | going forward needs a clean check at that phase; going back (late conflict) is always allowed |
| `note <text>` / `note --next <text>` | appends to `state.yaml` `notes:` or sets `next:`; flags count only as the first argument or before a `--` separator (`note -- "go to the --next step"` keeps the text) |
| `repair-counts` | recomputes `counts.units` and `counts.max_unit_id` in `state.yaml` from `units.yaml` (after an interrupted write) |

`units.yaml` is only appended to (`set-unit-verdict` is the one in-place change, and only to a verdict); the other files are rewritten in a canonical layout (strings quoted, one flow map per list item), **comments are not kept** (accepted). Every file is written through a temp file and a rename (mode 0600). Only the problems a change **adds** block it: one that already existed (a stale count after an interrupted write) never wedges later changes, and `counts` problems never block, `repair-counts` fixes them. Not available without file access (Desktop): see "Without the script".

### Content-structure rules (problems from `verify` on, warnings before; decisions and T4 always warn)

Mechanical, no judgment: the lead supplies the facts (template headings, kinds,
overview ids), the script compares.

- **H1 Headings against the template.** For each draft whose plan page has
  `template`: every heading is present as a level-2 heading (`## Heading`,
  case-insensitive, code blocks ignored); **H2** they come in the template's order
  (extra headings anywhere are fine); **H3** each has content under it: not blank, not
  only a comment, dash, ellipsis, `n/a`, `none`, `TBD` or `TODO` (a level-3 heading and
  its text count as content). A `create` page without `template` is flagged; an `update`
  without it is skipped with a note; a `template` that is not a list of distinct,
  non-empty names is always a problem.
- **T1** A placed `changelog` or `todo` unit: scope rule, drop it or link it.
- **T2** A placed `procedure` unit needs `type: task`, `also: [task]` or `form: log`.
- **T3** A placed `data` unit on a `concept` or `task` page filed in an Area (`Areas ›
  <Area> › ...`) is a method/data split problem, unless the page has `also: [reference]` or
  a decision with `mixed: <plan key>` is recorded. (Numbers go on a reference page or the
  prototype's book; one tiny table the human accepts gets the decision.)
- **T4 (warning)** A placed `decision` unit on a page that is not `type: note` (or a `log`),
  or on a note that holds other kinds too: an ADR is one atomic note (`form: adr`).
- A page with placed units and no `type` is flagged (the T rules cannot run).
- **O1 Area overview.** Every Area in which the plan **creates** a page needs
  `state.overview.<Area>` (page id, or `none` when it has no overview yet) and a plan page
  that edits it: an `update` with that `page_id`, or, for `none`, a page with
  `overview_of: <Area>`; or a decision with `skip_overview: <Area>`. A missing entry or edit
  is a warning at plan, a problem from verify. Find the id with `get_wiki_structure` or `search_wiki`.

### Without the script
Check by hand and say you did: count the units by verdict and compare with the
number of units, and `counts` in `state.yaml`; look for gaps in the unit ids; no unit text or draft holds a secret; each unit has a verdict and (if
placed) one existing target; each blocked source has a reason; search every draft
for `TODO`, `TBD`, `draft:` and `{{`; each link is `/link/<id>`, `ledger:<key>`
of a plan page or an absolute URL; each "Table N"/"Figure N"/"below" has its
table or figure; same-subject units that differ have a decision of the human (`decided_by: user`); every unit subject is under a sweep topic, every ranked page has a `pages.yaml` row, a digested page has headings and a digest, a candidate is digested or triaged out, every intake answer is in `policies`, a yes to rows or a short yes names its question, and the job folder holds no undocumented file; no unit of a live wiki page is dropped without a decision; no source is proposed `ready-to-delete` while a unit is pending, unplaced or dropped without a decision, and none is deleted, moved, renamed or edited without the human's decision naming that row and a re-read version equal to the inventory's; no pending unit before verify; a restricted source's units are only on restricted pages; plan units and inferred units have their decisions. For each draft: its plan page's `template` headings are `##` headings in that order, each with real text under it; a procedure unit sits on a task (or `also: task`) page, no changelog or todo unit is placed, no data unit sits on a concept or task page in an Area (unless a `mixed` decision), a decision unit is alone on a note page; each Area that gets a new page has `state.overview` filled and its overview page edited in the plan (or a `skip_overview` decision).
