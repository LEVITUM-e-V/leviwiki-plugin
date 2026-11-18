---
name: wiki-maintenance
description: >
  Work through the wiki's open issues and restructure it Area by Area: list
  the issues (unfiled pages, pages without a type: tag, stale pages, chapter
  sprawl, tag problems, possible secrets), propose fixes, preview them, and
  apply only after the human confirms. Triggers on "wiki maintenance",
  "what needs fixing in the wiki", "open wiki issues", "work the steward
  queue", "restructure" plus an Area name, "file the unfiled pages". Never writes to
  the wiki without an explicit go on the exact preview.
---

# Wiki maintenance

One loop: **list issues → propose fixes → preview → the human confirms → apply.**

**Modes** (default: maintenance):
- **A, maintenance:** work the open issues.
- **B, restructure:** file many pages into one Area at a time with a proposal. Switch here when most open issues are `outside-area` / `no-type`, or the user names an Area to restructure.
- **C, structure:** the wiki and the structure spec (what `get_wiki_structure` reports) have drifted (a rename, a move, a removed book or chapter, a tag renamed). Switch here for `structure-drift` conflicts, `tag-vocabulary` findings with a `renameHint`, or when the user says the structure was renamed.

## Before anything

1. **Check your tools.**
   - No `list_issues`: say the leviwiki plugin isn't connected and stop.
   - The steward tools are listed only for members of the `LeviWiki-Stewards` Entra group: `preview_apply`/`apply_proposal`, `preview_undo`/`apply_undo`, `preview_tag_rename`/`apply_tag_rename`, `preview_structure_fix`/`apply_structure_fix`. The rest (`list_issues`, `mark_reviewed`, `dismiss_issue`, `preview_page_tags`/`apply_page_tags`, `preview_edit`/`edit_page`, `preview_link_titles`/`update_link_titles`) every member has. If you need a steward tool and it's missing, say: "The steward tools are missing: you need to be in the LeviWiki-Stewards group, then sign in again (Claude Code: `/mcp` → Authenticate; Claude Desktop or claude.ai: disconnect and reconnect the leviwiki connector). If you are, the gateway's STEWARD_GROUP_ID isn't set up." Then continue report-only. Never improvise another way to write (no `publish_page` for moves).
2. **Call `get_wiki_structure`** (later calls in the session: `rules: false`). Areas, the other books (Organisation, prototype, archive) with their chapters, shelves, the tag vocabulary and `limits.chaptersPerAreaMax` come from there, never from memory. Classify every row by `rules`, `tags.rules` and `chapterRules` (shared detail: [reference/common.md](reference/common.md), "Structure"). No `rules` field: stop and tell the human the wiki backend is out of date.

## On Claude Desktop or claude.ai

The tools and the steward check above are the same there. Not tested there: the working files below live in `~/.leviwiki/restructure/` on the human's computer, which a chat there may not reach. If you can't write or re-read them, say so, keep the proposal in the conversation, and preview per Area in one sitting. More: [reference/common.md](reference/common.md), "On Claude Desktop or claude.ai".

## Hard rules (every mode)

**Writes**
- **Only after an explicit go on the exact preview you showed.** Any changed row means a new `preview_apply`. Never call an `apply_*` tool, `edit_page`, `update_link_titles`, `mark_reviewed` or `dismiss_issue` without that go.
- **Give the human the `reviewUrl` of every preview** (when it has one) with a one-line summary: the gateway renders the moves and tag changes there, read-only, after the same Microsoft sign-in. Don't retell the list in your own words; the yes is still given in the chat.
- **`confidence: low` is the human's call:** present the two most likely placements as options, not an answer. Never raise a row from low to medium or high yourself.
- **Never assume the issue list is complete.** `list_issues` returns 100 findings unless `limit` says more (max 500). Check `truncated`; if true, list again by `check` or `area` (there is no paging) until nothing is cut off.
- **A clean `own-permissions` needs `coverage.permissionsUnknown` at 0** (pages and chapters). Above 0 the check skipped items it couldn't read: say the list is partial.

**Pages you may not read, or not share** (shared rules and wording: reference/common.md, "AI-free pages", "Secret scan", "Restricted content")
- **Restricted.** A finding with `restricted: true`, or a page in a restricted Area or book (`restricted: true` in `get_wiki_structure`), is one ordinary members can't open. Read, classify and file it like any other page: `get_page`, `move` and `retag` rows and the tag fixes all work.
  - A move with a restricted side (a restricted book, or a chapter ordinary members can't open, on either side) may change who can read the page. `preview_apply` warns and marks it `access: opens` (out of a restricted place), `closes` (into one) or `changes` (between two). Show each such row on its own and get an explicit yes for it; never propose one just to tidy up.
  - Its content goes only where the same people or fewer can read it: to this human, or into a page in a restricted book. Never into a page in an open book, a proposal `reason`, a `dismiss_issue` reason, or a message others read.
- **`no-ai`.** A page tagged `no-ai` (or `sensitive`, retired), or in an `ai: false` book, is **metadata only**: `get_page` returns `aiBlocked: true` and no text; never get around that, never ask the human to paste its content.
  - `move`, `archive` and `retag` rows work on it, and none of its text reaches you. A row failing with "saved since this run's plan" needs a new preview. You can't classify it from its text: the human decides the row (shelf, type, chapter) from the title and what they know; set `confidence` as they say.
  - A page kept out only by its book (`ai: false`) loses that when it leaves the book: the row must add `no-ai` (`tags.add`), or preview refuses it. Ask the human first, since the tag keeps the page out of AI for good. No row removes `no-ai`, and no open page moves into such a book.
- **`secret-scan`.** `get_page` returns `aiBlocked: true`, `aiBlockedReason: "secret-scan"` and no text; `search_wiki` gives only its title. Never get around it, and never put its title into a search.
  - Report it as a link plus the pattern name, and tell the human to involve the IT Infrastructure owner.
  - In a proposal it is always `action: skip`, reason "secret-scan finding".

**Proposals and tags**
- **Allowed actions:** `move`, `archive` (also sets `status:deprecated`), `retag` (tags only, the page stays), `skip`. No merges or splits: merging pages or splitting one is the **wiki-builder** skill's migration route. Tell the human to start it there (more sources, a split or a merge routes to it); don't improvise one with rows.
- **Never** put `status:` or `last-reviewed:` into a proposal (`mark_reviewed` does those), nor an `owner:`/`book:` tag; preview refuses them.
- Proposals name **Area slugs, never book ids**.
- Tag values only from `get_wiki_structure`; a missing value is a vocabulary proposal for the steward, never an invented variant.
- **Chapters:** at most `limits.chaptersPerAreaMax` per Area, **existing chapters included**. Topic chapters only, never type-named ones ("Tasks", "References").
- **Tags without a move** (`status:deprecated` where it is, a `subsystem:` added, a stray tag off) and **renames** (title and link text on other pages) are not proposal rows: read [reference/tags-and-renames.md](reference/tags-and-renames.md) before the first one. Each is preview → yes on the exact list → apply.

**Scope: long-term knowledge vs changelog content** (the rules' "Scope: what the wiki keeps"). A topic-chapter page, or a page you read while classifying or confirming staleness, that is mostly commit hashes, "merged"/"bumped" events, per-run logs or to-do lists is a steward finding, however current it looks.
- Report it as a link plus a one-line reason. A proposal can't change page text, so the fix is the human's, or `preview_edit` (wiki-builder, Step 8a) to cut the log part and link the source, after a yes (no `reviewed: true` unless they confirmed the whole page).
- There is no log chapter to move it to (an open decision); never create one by a proposal.
- No `list_issues` check detects this: it is your judgement, and a `no-ai` page can't be judged.

## Mode A: maintenance

1. **List.** `list_issues` (`area` if the user named one: an Area slug, or `area: "board"` for the Organisation books; `onlyNew: true` for "what's new"). Findings come sorted action, warn, info. `stateAvailable: false` means no issue history: `onlyNew` is then meaningless, and `dismiss_issue` fails.
2. **Group by how each issue gets fixed,** with a short table per group (title, link, Area, message):

| Group | Checks | Fix |
|---|---|---|
| Filing | `outside-area`, `no-type`, page moves suggested by `chapter-sprawl` / `chapters-per-area` | a small proposal (mode B steps 4–6) for those pages |
| Confirm | `stale`, `canonical-without-review` | ask whether the page is still accurate (unless the page keeps AI out (`no-ai`), you may summarise it to help them judge). On a clear yes, `mark_reviewed {pageId}`; for several, ask once for the listed pages and call `mark_reviewed {pageIds: [...]}` (up to 50; a result per page: ok, skipped, or failed with the message). Obsolete: an `archive` row. `canonical-without-review` not confirmed: lower `status` (tags without a move) |
| Structure | `structure-drift` conflicts, `tag-vocabulary` with a `renameHint` | mode C |
| Retag | `confidence-low` (remove `confidence:low` once the human decided); `needs-review-open` with reason `duplicate` (remove it once resolved); `tag-vocabulary` without a hint (remove the tag or replace it with a vocabulary one; a bad `type:` value too, which a tag rename refuses); `tag-placement` (remove the tag, or keep the home and at most two cross-cutting values; more is several pages: tell the human, splitting is theirs); opting a page out of AI (add `no-ai`) | a small proposal of `retag` rows (mode B steps 4–6) with `tags: {add, remove}`, or `preview_page_tags` (tags without a move; no steward group needed) |
| For a person | `secret-scan`, `empty-page`, `book-owner-missing`, `own-permissions` (a page or chapter with its own permissions: move it into a restricted book, or remove them in BookStack; if they stay, an admin grants the Index reader role view there so it is searchable, and `no-ai` if AI must not read it) | show the finding's `fix.hint` and link. `empty-page`: fill it, add an `asset:` tag if it fronts a file, or an `archive` row. `book-owner-missing` is fixed on the server by the wiki operator (the structure build). `needs-review-open` with reason `type`, `status`, `vocabulary` or `stub`: fix the cause (a `type:` tag, a `status:` tag...); the hygiene validator clears the flag on the next edit. Removing `no-ai` is done in the BookStack editor |
| Not a problem | any except `stale`, `secret-scan`, failed checks and wiki-wide findings (refused) | `dismiss_issue {issueId, reason}` only on the human's word, with their reason |

3. **After any write,** list again and report what is left.
4. **Nothing open** (or nothing new): say so in one line.

## Mode B: restructure one Area

### 1. Inventory
- `list_issues {check: "outside-area", limit: 500}` and `{check: "no-type", limit: 500}`; while `truncated`, narrow by `area` (there is no paging).
- Split off at once and list for the human (title + link only):
  - pages that keep AI out (`no-ai`, or in an `ai: false` book): never `get_page` them for text; the human decides their rows (`no-ai` rule above)
  - pages with a `secret-scan` finding
- If `coverage.content` isn't `true`, the list has no `secret-scan` findings to split off: say so. `get_page` still blocks such pages (`aiBlockedReason: "secret-scan"`); treat one that comes back that way as a `secret-scan` page.

### 2. Classify, in batches of 10–15 pages
- `get_page` each remaining page. One that returns `aiBlocked: true` goes to the split-off list, by its `aiBlockedReason`.
- Decide by the filing tests and page types of `rules`:
  - **shelf:** Areas, Projects, Archive or Organisation
  - the **Area** (other shelves: the book's slug from `get_wiki_structure`, e.g. `p5`, `about`)
  - the **type** and `also:`
  - `subsystem:`: required on Projects/Archive pages, never on Organisation pages, otherwise only when cross-cutting; an archived page from an Organisation book (or already in an archive book, its origin gone) needs none
  - a **chapter**: a topic chapter of the Area book, or one of the book's own (a prototype book's: `prototypeChapters`, its Flight tests pages titled by `chapterRules`)
  - an obsolete page: `archive` into the Deprecated pages book (shelf `archive`, its slug from `get_wiki_structure`); a retired prototype's records: `move` to its archive book
  - a **confidence** and a one-line **reason**
- Write each row into its target Area's working file at once. After each batch keep only the rows in mind, not the page text.

**Working files:** `~/.leviwiki/restructure/<area>.yaml`, `~/.leviwiki/restructure/board.yaml` for rows going to Organisation, and `~/.leviwiki/restructure/steward.yaml` for rows going to Projects or Archive.
- Titles, ids and reasons only, never page text.
- **Never in the current directory** (often a code repository). If the user names another place, check whether it's inside a git work tree (`git -C <dir> rev-parse --is-inside-work-tree`); if it is, warn before using it.

### 3. Chapters
- `list_chapters` for the Area's book.
- Group the rows into topic chapters. Reuse existing chapters first; keep existing + new at or under `limits.chaptersPerAreaMax`.
- Name new chapters by topic ("Motor control", "Ground station"), never by type.
- Spell each chapter the same in every row, existing ones exactly as `list_chapters` shows them. A new chapter is created under the first row's spelling.

### 4. Review with the human
- Table of the Area's rows: title, action, chapter, type, confidence, reason.
- `confidence: low` rows first, each with its two options; the human picks.
- They may change any row or set it to `action: skip`.

### 5. Preview
- `preview_apply {proposal}` with the working file converted to a JSON object, same field names. Never the YAML text; it is refused.
- Errors: fix the rows (with the human if it's a judgement call) and preview again.
- Show `warnings` and `newChapters` verbatim, plus a count of changes.

### 6. Apply
- Only after an explicit go on that preview: `apply_proposal {proposal, previewToken}` with **exactly** the previewed proposal.
- Read [reference/apply-and-undo.md](reference/apply-and-undo.md) before the first call: the 25-pages-per-call loop, what to report, the `runs.log` line, and undo. Undo needs its own `preview_undo` and an explicit go on that preview before `apply_undo`.
- Any refusal: follow its message (table in that reference); preview again whenever it says so.

### 7. Next
List again (moved pages drop out), then the next Area.

## Mode C: structure

For structure-build stops on `structure-drift` conflicts or `tag-vocabulary` findings with a `renameHint`. Needs the steward tools `preview_tag_rename`/`apply_tag_rename` and `preview_structure_fix`/`apply_structure_fix`; if they're missing, say so as in "Before anything" and stop at the report.

Read [reference/structure-mode.md](reference/structure-mode.md) before the first step. Writes still need an explicit go on the exact preview.

## Proposal format

One proposal per Area; `area: board` for rows going to Organisation, `area: steward` for rows going to Projects or Archive:

```yaml
area: powertrain
rows:
  - page_id: 9002
    title: "ESC calibration"     # informational
    action: move                 # move | archive (sets status:deprecated) | retag | skip
    shelf: areas                 # areas | projects | archive | organisation
    area: powertrain             # when shelf is areas
    # book: p5                   # when shelf is projects, archive or organisation (slug from get_wiki_structure)
    chapter: "Motor control"     # existing name, or a new one
    type: task
    also: [reference]
    subsystem: [avionics]
    confidence: high             # high | medium | low
    reason: "how-to with steps → task; motor control belongs to Powertrain"
```

Details and every validation error: [reference/proposal-format.md](reference/proposal-format.md).

## Running without a human (scheduled)

Mode A up to "propose" only: list, group, write the report. No write tool at all: no `apply_proposal`, `apply_page_tags`, `apply_tag_rename`, `apply_structure_fix`, `apply_undo`, `edit_page`, `update_link_titles`, `mark_reviewed` or `dismiss_issue`.

## Skills version
If this skill's description ends in "(skills vX.Y.Z)" and the gateway's instructions name a newer skills version, tell the user once to replace the skill (reference/common.md, "Skills version").
