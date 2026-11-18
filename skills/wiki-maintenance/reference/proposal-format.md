# Proposal format

The file `preview_apply` and `apply_proposal` take: one proposal per Area. Rows going to Organisation go in a proposal with `area: board`, rows going to Projects or Archive in one with `area: steward`.

| Field | Required | Values |
|---|---|---|
| `area` (top level) | yes | an Area slug from `get_wiki_structure`, an owner slug (`board`), or `steward` |
| `page_id` | yes | the page's id |
| `title` | no | informational; if it differs from the wiki, `preview_apply` warns |
| `action` | yes | `move`, `archive`, `retag` or `skip` |
| `shelf` | for move; an archive row implies `archive` | `areas`, `projects`, `archive` or `organisation` |
| `area` (row) | when `shelf: areas` | the target Area's slug, never a book id |
| `book` | when `shelf: projects`, `archive` or `organisation` | the target book's slug in `get_wiki_structure` (`p5`, `about`; an archive row: the Deprecated pages book), or its BookStack slug |
| `chapter` | no | an existing chapter's name, or a new one. New ones count toward `limits.chaptersPerAreaMax`, existing chapters included |
| `type` | for move/archive | one of the page types |
| `also` | no | list of `concept`, `task`, `reference` (never `note`) |
| `subsystem` | Projects/Archive pages: yes, except an archived page that comes from an Organisation book; Organisation pages: no; Area pages: only when cross-cutting | list of Area slugs, 0–2 cross-cutting |
| `tags` | no; required for `retag` | `{add: [...], remove: [...]}`, each "name" or "name:value" (`no-ai`, `confidence:low`, `validation:tested`). A `retag` row changes these tags only and leaves the page where it is: no `shelf`, `area`, `book`, `chapter`, `type`, `also`, `subsystem`. On a move row they come on top of those fields |
| `confidence` | yes | `high`, `medium`, `low`. A `low` row was decided by the human |
| `reason` | yes | one line: why this shelf, Area, type and chapter |

**What apply changes,** in the same update: the page's book and chapter, and its `type:`, `also:` and `subsystem:` tags, plus the `tags` edit. A `retag` row writes the tags only. An `archive` row also sets `status:deprecated` (it replaces any other `status:` value): an archived page is deprecated. A `move` row to the archive shelf keeps the status, for a retired prototype's records that aren't out of date.

**`tags` refuses:** `status:`/`last-reviewed:` (`mark_reviewed`), `owner:`/`book:` (the book's identity: `preview_structure_fix`), `type:`/`also:`/`subsystem:` (the row's own fields), the hygiene validator's own `needs-review` reasons (`type`, `vocabulary`, `stub`, `status`; `duplicate` is yours to remove), a tag outside the vocabulary, removing a tag the page doesn't have, a second value of a single-value tag unless the row removes the first, and removing `no-ai` or `sensitive` (a person's step).

**What it never changes:**
- `last-reviewed:`, and `status:` except on an `archive` row (`status:deprecated`)
- a page's text. Pages that keep AI out (`no-ai` on the page or its book) are moved, archived and retagged like any other, and nothing of their text reaches you (apply doesn't fetch it; a page saved since the preview fails its row: preview again); but a page kept out only by its book must carry `no-ai` itself (`tags.add: ["no-ai"]`) before it leaves that book, and an open page is never moved into a `no-ai` book. Restricted pages and books are filed like any other; a move between a restricted and an open book is marked `access` (below)

**Each apply writes an undo log first.** Undo by run, page or Area: `preview_undo` / `apply_undo`, steward tools (it restores pages and tags, and never deletes: an empty chapter the run created is reported for a person to delete); `cli.js undo` on the server also deletes that chapter.

**Pass the proposal as a JSON object** with these field names, never as YAML or as a JSON string. The YAML file is the working copy; convert it.

## What `preview_apply` returns

- **`errors[]` and `warnings[]`:** items `{row?, pageId?, message}`, where `row` is the index in `rows`. Any error means no `previewToken`.
- **`changes[]`:** `{pageId, title, from: {book, chapter, tags}, to: {…}, newChapter?}`.
- **Other lists:**
  - `unchanged[]`: page ids already where the proposal puts them
  - `skipped[]`
  - `newChapters[]` `{book, name}`
  - `chapterCounts[]` `{area, book, now, after, max}`
- **`estimate`:** `{requests, seconds}`.
- **`previewToken` and `expiresAt`:** the token lasts 8 hours by default.
- **`note`:** what to do next. Show it to the person.

## Errors (no token until all are fixed)

| Message | Fix |
|---|---|
| proposal area "…" is not an Area or owner slug of the spec (or "steward") | use a slug from `get_wiki_structure`, `board`, or `steward` |
| page … appears more than once | keep one row per page |
| page … was not found, or you can't see it | drop the row; the page is gone, or your token can't see it |
| page … is a template or a generated structure page, which stay where they are | drop the row |
| shelf is required unless the action is skip | add `shelf`, or set `action: skip` (or `action: retag` with `tags`) |
| a retag row changes tags only: leave out shelf, area, … | drop those fields; or make it a move row |
| a retag row needs tags.add or tags.remove | add the tag change |
| tags.add/remove …: … belongs to mark_reviewed / the book's identity / the row's own field / the hygiene validator | not here: use the op or field named. To deprecate a page, archive it (`action: archive`), or set `status:deprecated` where it is with `preview_page_tags` |
| tags.remove no-ai/sensitive: AI tools never lift … | drop it; a person removes the tag in BookStack |
| tags.add …: … is not in the controlled vocabulary / not a recognised tag name | use a vocabulary tag (`get_wiki_structure`) |
| tags.remove …: the page doesn't carry it | drop it |
| tags.add …: the page already has …, and … takes one value | remove that one in the same row |
| action archive needs shelf archive, not … | `shelf: archive` |
| type is required unless the action is skip | add `type` |
| type "…" is not one of concept, task, reference, note | use a page type |
| also "…" is not one of concept, task, reference | fix or drop it |
| also "…" repeats the type | drop it |
| subsystem "…" is not an Area slug | use an Area slug |
| area is required on the areas shelf | add the row's `area` |
| area "…" is not an Area slug | use an Area slug |
| page … keeps AI out only through its book's no-ai, which it loses in "…" | add `no-ai` to the row's `tags.add` (ask the human: it keeps the page out of AI for good), or drop the row for a person |
| book "…" keeps AI out (no-ai): apply never moves an open page into it, a person files it | a person files it (an `ai: false` book); drop the row |
| this is the … proposal, but the row targets … | move the row to that Area's proposal |
| no Area book for … (the structure must be built first) / … books are owned by …; expected one | stop and tell the human: the structure isn't built (a `structure-drift` issue) |
| chapter is required on the areas shelf: pages are filed into a topic chapter | add a topic chapter |
| book is required on the … shelf | add the book's slug from `get_wiki_structure` |
| no book "…" on the … shelf / book "…" is on the … shelf more than once | check the slug with `list_books`; ask the human |
| a … page needs subsystem: (the Area it belongs to), the only thing that surfaces it in an Area | add `subsystem: [<area>]` (not needed for an archive row of a page from an Organisation book) |
| … would have … chapters, more than …: file into existing chapters instead of adding … | merge new chapters into existing ones |

## Warnings (shown to the person; the token is still issued)

- title "…" doesn't match the page's "…"
- a note is atomic: also: on a note is unusual
- subsystem "…" names a restricted Area
- page … is restricted and moves to "…", which more people can open: make sure nothing in it has to stay restricted (the change carries `access: "opens"`)
- page … moves into the restricted "…": members outside its roles can't read it any more (`access: "closes"`)
- page … moves from one restricted place to another, "…", whose readers may differ: check who can open it (`access: "changes"`)
- page … has permissions of its own, which move with it
- confidence is low: a person should decide this row (it gets the confidence:low tag)
- subsystem "…" repeats the page's own Area
- … already has … chapters, more than …

A change with `access` may change who can read the page: a restricted book, or a chapter ordinary members can't open, on either side. A page hidden by its own permissions alone keeps them on the move: that gets only the warning above, no `access`. Neither does a move between open chapters of the same restricted book. Show each such row to the person on its own and get an explicit yes for it. Whether the target is restricted is part of what the token confirms, so a target that became restricted or open since the preview makes the apply refuse the token: preview again. The `access` mark itself goes once the page has moved, so a second call with the same token still fits.

## `apply_proposal`

**Batches.** It applies up to `limit` pages per call (default 25, max 100). While `remaining` is above 0, call it again with the **same** proposal and token, while it is valid.

**Refusals** (`isError`, nothing written unless the message says so):

| Message starts with | What it means and what to do |
|---|---|
| "the proposal doesn't validate against the wiki as it is now" | the wiki changed since the preview; preview again |
| "confirm gate rejected this apply: …" | expired, or the proposal differs from what was previewed; run `preview_apply` again and confirm with the person |
| "stopped: …" | partly done (it's in the undo log); call again with the same token to continue |
| "another apply or undo is running" | wait, then retry |
| "BOOKSTACK_PROBE_TOKEN is not set" / "RESTRUCTURE_DATA_DIR is not set" | the server isn't set up for this; tell the human |

**Per-row `failed[]` reasons:**

| Reason | What to do |
|---|---|
| "gone, or you can no longer see it" | nothing to do |
| "BookStack refused (403): moving a page needs permission to update and to delete it" | the person's role can't move this page; someone with delete rights does it |
| "BookStack answered …" | report it |
| "moved but its tags weren't set; run apply_proposal again with the same token" | call again |
