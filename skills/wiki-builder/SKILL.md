---
name: wiki-builder
description: >
  Create or update BookStack wiki pages from what was discovered in the
  current session, or from material the user provides — authored text,
  datasheets, log files, spreadsheets and CSVs, pasted images, CAD, or meeting slide decks.
  Triggers on "save this to the wiki", "write this up", "capture this",
  "/wiki", or when the user wants a finding, fix, decision, procedure, or
  reference preserved. Classifies into the PARA/DITA/tag structure, checks
  for related pages first, attaches files to a searchable stub
  page, and always requires human confirmation before publishing. Also
  migrates many sources into many pages without losing or inventing
  anything (a SharePoint or OneDrive folder, repository docs, old wiki
  pages), splits one page into several, merges several into one: triggers
  "migrate", "import this SharePoint folder", "split this page", "merge
  these pages", "bring these documents into the wiki".
---

# Wiki builder

Turn what the session found (or what the user hands over) into a wiki page:
gather → classify → check duplicates → ask → draft → cold read → preview →
**human yes** → publish.

## Step 0 — Route: one page or a migration

- One source (or this session) that becomes **at most two pages**: this
  file's flow, Steps 1-9, unchanged.
- **More sources or pages**, one page **split** into several, or several pages
  **merged** into one: read [reference/migrate.md](reference/migrate.md) now and
  follow that flow (ledger, units, coverage check; its steps are M1-M9). Its
  references are `migrate-ledger.md`, `migrate-decompose.md`,
  `migrate-coverage.md` and `migrate-publish.md`; read them where it says so.
  Steps 1-9 below then serve its drafts (template, scope check, cold read,
  preview), not the whole job.
- Say which way you routed and why. Unsure: ask once.

## On Claude Desktop or claude.ai

Not tested there: the file upload in Step 6 (it needs a command that PUTs bytes) and the long-draft file in `reference/preview.md`. If you can't do either, say so and show the draft in the chat; the cold reader may be missing too (Step 7). More: [reference/common.md](reference/common.md), "On Claude Desktop or claude.ai".

## Hard rules (always)

1. **No write without a yes on the exact preview you showed.** Never
   auto-publish. Any change to a draft or edit, however small, means a new
   preview and a new yes.
2. **Structure comes from `get_wiki_structure`, never from memory:** Areas,
   books, chapters, filing rules, page types, templates and tag values.
   Tags from its vocabulary only; a missing value is a proposal for the
   steward, never an invented variant.
3. **Every page has a `type:` tag.** Chapters are by topic, so the type lives
   only in the tag.
4. **Update before duplicate; one idea per page.**
5. **Only what is there.** Describe and extract only what is present; never
   invent specs or values. `validation:researched` by default; never claim
   tested or flight-proven without a linked test or flight and the human's
   confirmation.
6. **Low confidence is shown, not hidden.** Present the two most likely
   options and add `confidence:low`; never default silently.
7. **Long-term knowledge and changelog content never share a page:** no
   commit hashes, "merged"/"bumped" events, per-run logs or to-dos in a page
   of long-term knowledge (Step 2, "Scope"; Step 5, scope check).
8. **Secrets.** Passwords, tokens and bank data never go in the wiki: tell
   the user to use the password manager or restricted SharePoint and link to
   it. Never put API tokens or other credentials into the conversation.
9. **AI-free places.** A book with `ai: false` in the tool's result keeps AI
   out: don't draft a page for it. Tell the user to write it in BookStack
   themselves (the tools refuse it anyway) and give the filing you would have
   proposed. A page the user wants AI-free in an ordinary book gets the
   `no-ai` tag in the preview; say that anyone who can edit the page can
   remove it, and that an `ai: false` book is the safe place for anything
   confidential. A `no-ai` or `secret-scan` page you find (`aiBlocked: true`)
   is never read another way: no other tool, no search for its title, no asking
   the user to paste it (common.md). For `secret-scan`, the user can open it
   in BookStack themselves.
10. **Restricted content stays restricted.** What came from a restricted page
    goes only where the same people or fewer can read it, never into a page
    in an open book (not as a quote, a summary or a related link's
    description). Leave that part out of such a draft and tell the user why.
    A restricted book that allows AI is filed and written like any other.

Detail for 2, 9 and 10, the search recipe and OneDrive files:
[reference/common.md](reference/common.md), read when the case comes up.

## Step 1 — Gather from context first
Runs on an explicit request, or when the user signals they want the
session's findings kept; if that is implicit and you're unsure, ask once.
Pull the substance (fix, insight, decision, procedure, reference) and any
provided or pasted artifacts from the session and draft your understanding.
Never ask the user to re-explain what is already in the conversation.

## Step 2 — Classify (with confidence)
- Call `get_wiki_structure` once per session (later calls `rules: false`):
  `rules` (filing tests, types, naming), `tags.rules` and `chapterRules`
  say how to classify (common.md, "Structure"). Without `rules`, stop and
  tell the user the wiki backend is out of date.
- If no book or chapter fits, surface it rather than inventing a home.
- Propose: subsystem/project tags (`project:` is the prototype book's slug,
  e.g. `p5`), any `also:`, and the `validation:` level (hard rule 5).

**Tags (every time):**
- `subsystem:`, `also:` and the rest follow `rules` and `tags.rules`, e.g.
  at most `maxCount` `subsystem:` values. More means the page is several
  pages: propose splitting by concern, not tagging by breadth.
- Flag over-generic or over-broad tag sets before publishing and pare them
  back.
- Concern tags are separate from `subsystem:`: propose `safety` on any
  hazard, limit, failure mode or abort condition.

**Scope: what the wiki keeps** (the rules' section of that name). Sort the
session's material into two kinds before drafting:
- *Long-term knowledge* (goes in topic pages): design, how it works,
  decisions with their dates and reasons, durable procedures, reference
  data, version and parameter numbers, pinouts, lessons, the current state
  as "what works, what doesn't, why, what is next".
- *Changelog content* (never in a topic page): which commit was merged, a
  submodule pin bumped, a per-run log, a to-do list, wiki housekeeping. E.g.
  "merged PR #212, bumped submodule px4-firmware to 1.15.2", a per-run
  results table, "to do: rename the old pages". Link it (commit, issue,
  repo file) or drop it; if worth keeping, it becomes a separate dated log
  page (one per period or event).
- There is no log chapter yet (an open decision): don't invent one and
  don't file a log into a topic chapter. Test logs keep their place (a
  prototype's Flight tests; in Testing: Fuel cell tests, Test rigs). Log
  analysis is flight-log analysis knowledge, not a log chapter. Surface
  anything else to the human.

## Step 3 — Check for duplicates and relations
Do this before asking anything: a strong match turns a new page into an
update, which changes every other question.
- `search_wiki` with `query` one English sentence describing the page's
  topic and `keywords` up to 3 variants (English and German, one language
  per variant; recipe in common.md, "Searching"). `get_page` the best hits.
- Strong match: propose updating (or linking) it, not a duplicate.
- Keep the 2-3 most related pages' ids for `relatedPageIds`.
- `source: onedrive` results are files: link them, never copy their content
  into a page or upload them again (common.md, "OneDrive files").

## Step 4 — Ask only for real gaps
One short batch: ambiguous shelf/book (show your proposal), create vs update
when a near-duplicate exists, subsystem/project if not inferable, validation
level if you can't infer it, and confirmation of any asset to store.

## Step 5 — Draft
- **Template:** the page type's entry in `templates` (headings in order, a
  hint under each). A decision record is the `adr` template, a test log
  entry (flight test, rig session, test run) the `log` template; both are
  type `note`. A hybrid (`also:`) keeps its primary template and adds the
  also type's `alsoSection` before Related.
- Keep notes atomic; follow the naming conventions; the filing rules'
  worked examples show titles and placements for hard cases.
- **Tone and depth:** if Step 3 found a good page of the same type in the
  same Area (`status:canonical` or `reviewed`), match its level of detail;
  don't copy its content.
- **Chapter:** always in a chapter of its book, never a type-named one. Area
  book: a topic chapter (`get_wiki_structure` lists them). Prototype book:
  one of Overview, Design, Airframe, Powertrain, Avionics, Flight tests.
  Propose it from subsystem + subject; if unclear or new, surface it for
  confirmation rather than guessing, never create one silently.
- **Existing page:** start from it as it is (`get_page`: `format` =
  markdown | html | empty, and `sections`) and change it via Step 8a, not an
  update draft. `publish_page` updates are deprecated, and refused for a
  visual-editor page (`format: html`).

**Scope check** before the cold read and before every preview. Scan the
draft for commit hashes, branch names, "was merged", "was bumped",
"submodule pin", who-merged-what-when, per-run tables, TODO lists, wiki
housekeeping (not: decisions with dates and reasons, version, firmware or
parameter numbers, pinouts, lessons, the current state). For each hit, tell
the human and offer: **link** (to the commit, issue or repo file),
**remove**, or **move** into a separate log-page draft. Never preview a page
that still mixes them. A dated test-log entry in the `log` template is fine,
with all its sections (Follow-ups, Raw data ...): it is a page of its own
kind. Detail that changes often (a state or run table) stays in the
repository; the page summarises and links it.

**Draft object** (`preview_publish {draft}`):
- `op`: create | update; `pageId` (update)
- `bookId` (create; from `list_books`); `chapterId` (from `list_chapters`
  for that book) or `newChapterName` (a confirmed new chapter)
- `title`, `markdown`
- `tags`: `[{name, value}]` with `type` and the rest; `status:draft` for a
  new page; never `last-reviewed` (publishing sets it)
- `relatedPageIds`: pages that get a back-link. Not a `no-ai` page (add
  those by hand). A visual-editor page gets the link spliced into its HTML
  and is read back; a page that already links to it is left as it is.
- `assetHashes` (Step 6)

## Step 6 — Files (only if there are any)
Read [reference/files.md](reference/files.md) before the first file step:
staging, extraction per file kind, and the stub page around each file.

## Step 7 — Cold read
Have the draft read by someone without this conversation. Skip it for a
short note (a few lines) or when the human asks.
- With the Agent tool: call `leviwiki:wiki-cold-reader` with ONLY the title,
  the filing (book › chapter), the type, that template's headings and hints,
  and the markdown. Never the conversation; never restricted-page content
  for an open-book draft.
- Without it: reread the draft yourself as a new member who wasn't here:
  undefined terms, numbers without units, "the fix above" / "we" / "last
  time", missing steps, unsourced claims.
- **The cold reader is a Claude Code plugin agent and is usually not there in
  Claude Desktop or claude.ai** (no Agent tool, or no `leviwiki:wiki-cold-reader`).
  If you have no Agent tool, or the call fails because the agent doesn't
  exist, don't stop and don't skip the step: do the critical review yourself,
  as in the bullet above. Be hard on the draft, not kind: list every question
  a stranger would have, then answer or fix each one as below. Say in the
  preview that the cold read was done by you, not by a separate reader.

For each question: answer it from the session and fix the draft if you can,
otherwise keep it for the confirm step (one batch, with the preview). Tell
the human how many it raised and how many you fixed.

## Step 8 — Preview and confirm
`preview_publish {draft}`; if it refuses, fix the draft and preview again.
Show it as [reference/preview.md](reference/preview.md) lays out: the
`summary` as returned; what the human must decide (`confidence:low`,
`tagIssues`, a new chapter, open cold-reader questions); the diff or the
page; one question: publish, change something, or cancel.

**More than about 3 pages, or new pages that link each other:** one
`preview_changeset` (new pages, edits and tag changes in one set, links between
the new pages as ordinary markdown links to `draft:<key>`), one review link, one approval, then
`apply_changeset`: [reference/changeset.md](reference/changeset.md). Where the
gateway requires **Approve on the review page** (the result's `gate` says
`require`), hand the human the link and wait for them to say they pressed it: a
typed yes is then not the approval. Without `preview_changeset`, one preview
per page as above.

## Step 8a — Changing an existing page
`get_page` first: `format` and `sections` say how.
- **`markdown`:** `preview_edit {pageId, ops, summary}`. Ops:
  `replace-section` (everything under a heading, sub-sections too),
  `insert-section-after` (`after`: a new section right after that one, never
  after a closing Related), `append-section` (a new section before a
  closing Related), `replace-all`. `summary`: one line, ≤ 180 characters,
  becomes the BookStack revision note. Chapter and tags stay, except `tags`
  (`{add, remove, set}`, with the same rules and vocabulary as
  `preview_page_tags`; the preview lists what is added and removed; they go
  in the same save as the text). An edit is not a review: **last-reviewed
  stays as it is** unless you pass `reviewed: true`, and you pass it only
  after asking the human "is the whole page accurate today?" and getting a
  yes (not for a page you changed in part, or one section of a migration).
  The summary says which: "last-reviewed stays <date>" or "set to today".
  Tags alone, with no ops, or `reviewed: true` alone, are refused:
  `preview_page_tags` / `apply_page_tags` and `mark_reviewed` are the tools
  for those.
  Show the `summary` and the whole `diff` (reference/preview.md, with the `reviewUrl` when the result has one); after a yes
  on exactly that preview, `edit_page {previewToken}`.
- **`empty`:** a single `replace-all` op in `preview_edit`.
- **A rename alone** works on any page, `no-ai` and visual-editor pages
  included: it doesn't read the text, needs no conversion and doesn't set
  last-reviewed. Converting a visual page to markdown (`preview_convert`) isn't
  a review either and sets nothing.
- **A visual-editor page (`html`)** is edited with the same `preview_edit`:
  the preview converts it and applies the ops in one go (conversion loss
  report first, one yes, one `edit_page`). `tags` and `reviewed: true` are
  refused there: use `preview_page_tags` / `mark_reviewed` after the edit.
- **`html` (visual editor) details, a rename, or `edit_page` returning `next` (link
  titles after a rename):** read
  [reference/edit-existing.md](reference/edit-existing.md) first.
- "edited since the preview": `get_page`, preview again, confirm again.

## Step 8b — Retiring a page
A page that was merged into another, replaced or is obsolete is archived,
not left in place and not moved by hand. Read
[reference/retire.md](reference/retire.md) before the first step: it needs
steward tools, and there is a fallback without them. Without the steward
tools, never shrink the page to a pointer.

## Step 9 — Publish (a new page)
After an explicit yes on that preview: `publish_page {previewToken}` (the
draft is kept with the token; don't send it again). It creates the page
(updates through it are deprecated, Step 8a), sets `last-reviewed:`, writes
the back-links on the `relatedPageIds` pages and attaches every staged file
in `assetHashes`.
- "edited since the preview": someone changed the page meanwhile. `get_page`,
  merge their change into the draft, preview and confirm again.
- "no previewed draft for this token": it expired (previews last 8 hours by
  default) or the gateway restarted. Preview and confirm again.
- An attachment with `attached: false`: see the end of reference/files.md.

Report the url, back-links written or not (and why), attachments, and how to
undo (reference/preview.md, "After publishing").

## Skills version
If this skill's description ends in "(skills vX.Y.Z)" and the gateway's
instructions name a newer skills version, tell the user once to replace the
skill (reference/common.md, "Skills version").
