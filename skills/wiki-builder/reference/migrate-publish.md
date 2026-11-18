# Publishing a migration

Read at Steps M8 and M9. Every write is a preview and an approval of exactly that
preview; a changed draft means a new preview. The job is published as **one changeset**
([changeset.md](changeset.md): tools, ops, the approval, a stopped run), or as a few when the
limits force it; the page-by-page loop below is the fallback for a gateway without
`preview_changeset`.

## Order

`node scripts/check-ledger.mjs <job> --order` prints it: a page comes after
the new pages it links (`links_to` in plan.yaml), **archive pages come last**; pages that link each other
(listed as a cycle) are published without those links, and the link pass adds them.
An existing page that should link new pages is an `update` in the plan,
published after the new ones.

## The job as changesets

`node scripts/check-ledger.mjs <job> --layers` prints the sets: the pages in that order,
grouped within the gateway's limits (40 ops, 25 creates, about 1.2 million characters). One set
unless the job is bigger; a split falls in dependency order, so a later set links earlier
pages by their real ids. It also names the pages in a cycle.

For each set, in order (and, when the job has several sets, only after the previous set is
applied and its ids are in `state.yaml`):

1. `phase: publish` in `state.yaml` (once), and the entry `changesets: [{status: previewed,
   plan: [keys]}]` for this set.
2. **Links in the ops' text** (the draft files keep their `ledger:<key>` links):
   `ledger:<key>` of a page **in this set** becomes `draft:<key>` (the op key is the plan key,
   lower-cased); of a page published earlier, `/link/<id>` from `state.yaml`; of a page
   in a cycle with this one, plain text (the other page's title), and the link goes in the
   fixup set below. Never a `ledger:` or a bare `draft:` anywhere else: the preview refuses it.
3. **Ops:** a plan `create` is a `create` op (`bookId`, `chapterId` from `list_books` /
   `list_chapters`, or `newChapterName`; tags from the vocabulary, `status:draft`, never `last-reviewed`).
   A plan `update` is an `edit` op: `ops` are section ops (`replace-section`,
   `insert-section-after`, `append-section`) over `replace-all`, which retypes the whole page
   and can hide a typo in the diff; the sections are the headings in the plan page's
   `template`; `tags {add, remove, set}` and `reviewed` as in `preview_edit` (false unless
   the human said the whole page is accurate); a visual-editor (html) page goes in as an
   `edit` op with the conversion's loss report first and without `tags` / `reviewed`.
   A page that keeps AI out is never an op that changes its text. Before the preview the
   script must have run clean at `phase: verify`, and each draft's sha256 must equal
   `state.verified` (a change at the preview sends the page back to Step M7).
4. `preview_changeset`, show it as changeset.md lays out (review link, counts, what the human
   decides), get the approval its `gate` names, `apply_changeset`.
5. **Write the ids into `state.yaml` at once, all together:** `published: - {plan: p1, page_id: 612}`
   for every entry of `created[]` (and `already-done` ones), the entry's `run_id` from the
   result and `status: applied`, or `stopped` when the run stopped. A page the human decides not to
   publish gets `skipped: [{plan, reason}]` instead; the script's `--close` accepts nothing else, and
   fails a `changesets` entry that is not `applied`.
6. **A stopped run:** changeset.md, step 6. Pages the run wrote are in `published` already;
   `resume` binds their ids and skips them. After "edited since the preview" on a page: `get_page`,
   merge, and resume with the changed op.

**Pages that link each other in a circle:** the first set creates them without those links. After it is
applied, one more changeset of `edit` ops (`append-section` / `replace-section`, `reviewed`
false) adds the links, using the now-known ids as `/link/<id>`. Then `check-ledger.mjs --final`.

Several sets for one job: the same eval cases cover a split, a run that stops half way and a
resume.

## The loop, per page (fallback: no `preview_changeset`)

1. `phase: publish` in `state.yaml` (once).
2. Links in the text sent to the preview: a `ledger:<key>` of a published page
   becomes `/link/<id>` (from `state.yaml`); one of a page without an id yet
   becomes plain text (the page's title). The draft file keeps the `ledger:` link.
3. New page: `preview_publish {draft}` (create; `bookId`, `chapterId` from
   `list_books` / `list_chapters`, tags from the vocabulary, `status:draft`,
   `relatedPageIds` for back-links, never a `no-ai` page's). Existing page:
   `preview_edit {pageId, ops, tags: {add, remove, set}, summary, reviewed}`
   with section ops (`replace-section`, `insert-section-after`, `append-section`)
   over `replace-all`, which retypes the whole page and can hide a typo in the
   diff. The sections an update writes are the headings in its plan page's `template`
   (the script checked them at verify). `reviewed: false` unless the human said the whole page is accurate.
   A visual-editor (html) page goes straight into `preview_edit`: the loss
   report comes first, show it, then the diff. Leave `tags` and `reviewed`
   out for such a page (refused); after `edit_page`, change tags with
   `preview_page_tags` / `apply_page_tags` and stamp with `mark_reviewed`
   only on the human's word.
4. Show it as SKILL.md's preview step (Step 8, reference/preview.md) lays out (review link, summary,
   what the human decides, diff or page, one question).
   **Before a preview of an existing page, re-read its revision** (`get_page`, or `list_pages` /
   a search hit's `revision_count`) and record it as `revision_rechecked` in its `pages.yaml` row
   (`ledger.mjs upsert-page`). A value other than the row's `revision` means the page changed since it
   was digested: read it again, redo the compare for its units, preview again. A row **without** `revision` (a keyword-only or `degraded` result carries none) is
   re-read with `get_page` and gets `reread: get_page` as well. The script checks this from `publish` on.
5. After the yes: `publish_page {previewToken}` / `edit_page {previewToken}`.
   Tokens last 8 hours. "Edited since the preview": `get_page`, merge, preview
   and ask again.
6. **Write the id into `state.yaml` `published` before anything else:**
   `- {plan: p1, page_id: 612}`. A compaction between two pages must lose nothing.
   A page the human decides not to publish gets `skipped: [{plan, reason}]` instead;
   the script's `--close` accepts nothing else.
   Before the preview, the script must have run clean at `phase: verify`, and the draft's
   sha256 must equal `state.verified` (a change at the preview sends the page back to Step M7).

A refusal: fix the draft with the human, preview again. A failure after some
pages are published: stop; `state.yaml` says which are; resume from there.

## Link pass

After the last page: for each draft with a `ledger:<key>` link, replace it with
`/link/<id>` in the draft file and `preview_edit` the live page (`replace-section`
of that section), show, yes, edit. Then `check-ledger.mjs --final`.

## Split and merge

Neither is a move: they rewrite text, so they go through this loop.

- **Split page X into A, B, C:** all of X's units are mapped to the new
  pages (`create`) or back to X (`update`; X keeps what stays). X is read once
  (units, in a subagent if the page is long); drafts only from units. Publish
  A, B, C first, then shrink X to what stays or retire it. Inbound links to X:
  `search_wiki` for X's title and slug; links shown with X's title are handled by
  `preview_link_titles` after a rename, the others are edited by hand.
- **Merge pages X, Y into Z:** both pages' units in the ledger, conflicts
  reconciled (Step M5), one draft. Publish or update Z, then **retire X and Y**
  (SKILL.md Step 8b, "Retiring a page": pointer text, then the archive row, which
  needs the steward tools; without them mark `status:deprecated` with
  `preview_page_tags` and give the human the archive rows). Never retire
  before Z is published and its id is in the ledger.
- A `no-ai` or restricted page can be moved or retired, never split or merged
  (its text isn't readable, or may not go to a page others read).
- Retiring pages: `action: archive` rows with `page_id` in plan.yaml, shown in
  the plan table. **Retire order:** edit every page that links a page to be archived (and link-pass
  edits) **first, archive last**. BookStack rewrites full links to a page on the pages that link it when
  the page is moved to another book or renamed, and saves a new revision of each, so an approved
  `preview_edit` of such a page is refused afterwards (seen in a pilot run: pages that linked an archived page).
  `/link/<id>` links are not rewritten, which is why drafts use them. The order holds either way: edits
  first, archive last, and the script lists archive pages last (`--order`) and refuses one published before the edits.

## Source restructuring (Step M9)

After the last page is published, the sources get a proposal, never an action. Set each row's
fields in `inventory.yaml` (migrate-ledger.md, "Source fates"), run
`check-ledger.mjs <job> --dispositions` and show its table: **one table, one row per source**.

| Column | Content |
|---|---|
| path | the source's path or URL, and its version from the inventory |
| `disposition` | `ready-to-delete`: every unit is on a published page, linked elsewhere or dropped with the human's decision (the script proves it and refuses the proposal otherwise); `move` / `rename`: to mirror the wiki structure, e.g. one folder per Area; `keep-linked`: it stays and the named wiki page links it (OneDrive material: CAD, raw data, measurements, slides as records, contracts, spreadsheets used as tools); `edit`: e.g. a GitHub README whose duplicated text is replaced by a link to the wiki page; `leave`: nothing changes |
| reason | one line |
| lives at | the wiki links where its content now lives |
| breaks | for `move` / `rename`: the wiki pages that link the old path, and the order that avoids a broken link: move, then `preview_edit` those pages with a yes each |

A live wiki page is no row for delete, move or rename: the plan retired it with an archive
page (`fate: archived`). A **repository file** (`kind: github`) is only ever `edit`, `keep-linked`
or `leave`; the script refuses `ready-to-delete`, `move` and `rename` for it.

**Doing it, only after the human's yes for exactly the rows they name** (a yes to the plan or to
publishing is none; a yes for some rows leaves the others untouched):

1. Ask a direct question that **names the rows** (show the table; `open_questions` entry with
   `rows: [s03, s05]`). A **short "apply" or "go" answering it is a valid yes** for exactly those rows, also for
   SharePoint moves; the human does not have to quote file names. Write it as a decision:
   `{id, rows: [s03, s05], text: "apply", via_question: q7, decided_by: user}`; the script compares the
   decision's rows with the question's and refuses any decision with `rows` that has no `via_question`, whatever its length. For a hard
   delete the human must ask for that, and the decision says `hard_delete: true`.
2. Re-read the source's version (`wiki-source-reader` in `inventory` mode, or the connector). Not
   equal to the inventory row's `version`: **stop for that row**, re-decompose the changed
   source (Step M3), don't delete.
3. Do it with the tool the human confirms each call of (the SharePoint and GitHub write tools
   are never on an allow list). Delete = move to `_moved-to-wiki/<job>/…` at the top of the source's folder tree;
   a repository file is edited on a branch for the human to review, never the default branch.
   A move that breaks wiki links: move, then update each page with `preview_edit` and a yes, and
   check with `get_page` that the new link is there.
   A repository edit (replace duplicated text by a link to the wiki page, or reduce a moved file to a
   short pointer): clone locally, a new branch, the change, `gh pr create`, each command confirmed by
   the human; never a push to the default branch and never a merge by you. The human merges.
4. Write the row at once: `fate` (`moved`, `renamed`, `edited`, `deleted`), `decision`,
   `executed_at`, `version_checked`; for a repository edit also `branch` and `pr` (URL or number). The
script fails a changed source or an edit without them.
