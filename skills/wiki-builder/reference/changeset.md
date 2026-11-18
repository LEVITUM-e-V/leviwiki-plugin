# Changesets: one preview and one approval for several pages

Read at Step 8 when the job is **more than about three pages, or pages that link each other**,
and at Step M8 of a migration. One page stays on `preview_publish` / `preview_edit`. Needs the
gateway's `preview_changeset` and `apply_changeset`; if either is missing, work page by page
(Step 8, or migrate-publish.md "The loop, per page") and say so.

## What goes in

`preview_changeset {title?, ops}`: each op has a unique `key` (a-z, 0-9, `-`, at most 40
characters; in a migration the plan key, lower-cased) and a `kind`:

- `create`: `bookId`, `chapterId` **or** `newChapterName`, `title`, `markdown`, `tags`
  (one `type:`; never `last-reviewed`: a changeset sets none), `summary?`. Checked as
  `preview_publish` checks a create, plus a secret scan of the text.
- `edit`: exactly `preview_edit`'s input, plus `key` and `kind: "edit"` (an unknown field is refused):
  `pageId` (number), `ops` (the section operations below), `title?` (a rename; with no `ops` it is a rename alone), `summary?` (up to 180 characters, the revision note),
  `reviewed?` (false unless the human said the whole page is accurate), `tags? {add, remove, set}` (lists of `name` or `name:value`; only together with `ops`), `gfmTables?`.
  A visual-editor page is converted by the same op: no `tags` or `reviewed` for it. The section `ops` (each names a heading of the page as it is now; get_page lists them):
  `{op: "replace-section", heading, markdown, level?}` replaces everything under the heading and keeps the heading line;
  `{op: "insert-section-after", after, afterLevel?, heading, markdown, level?}` adds a new section after the section `after`;
  `{op: "append-section", heading, markdown, level?}` adds one at the end, before a closing Related section (refused if the heading exists);
  `{op: "replace-all", markdown}` replaces the whole page and must be the only op. Example:
  `{key: "p3", kind: "edit", pageId: 9005, ops: [{op: "replace-section", heading: "Tools", markdown: "The team uses KiCad for PCB design."}, {op: "append-section", heading: "Related", markdown: "- PCU 1.0 schematic sheets"}], summary: "PCB tool: KiCad", reviewed: false}`.
- `tags`: `pageId`, `add`, `remove`, `set` (`preview_page_tags` for one page; works on
  `no-ai` pages). A page's tag changes ride in its `edit` op when it has one: two ops on
  one page are refused.

Links between the new pages: an ordinary markdown link whose address is `draft:<key of the
other create>` (text "First finding", address `draft:child-1`), and nowhere else (an autolink in angle brackets is refused; not in
prose, not in an image, not in the text of a link; a key that is not a create of the set is
an error). The gateway writes the real `/link/<id>`, in an order where a page
comes after the pages it links, and the review page shows `→ new page "<title>"`. Links to
pages that already exist are written as `/link/<id>`, as always. **Two new pages that link
each other** are refused: leave the back link out of the second one, and add it afterwards
with a second changeset of `edit` ops.

Limits: 40 ops, 25 creates, about 1.5 million characters of markdown in one set. A bigger job
becomes several changesets: split in dependency order (a page after the pages it links),
`check-ledger.mjs <job> --layers` prints the sets of a migration; later sets link the
earlier sets' pages by their real `/link/<id>` (the ids are in the apply result).

## The flow

1. **Preview.** Build the ops from the drafts (never a page the human hasn't seen in a
   draft; the cold read of Step 7 and, in a migration, the coverage check of Step M7 came
   first). Send them once. Errors name the op by key and all come back together: fix and
   preview again.
2. **Show it.** Give the human the `reviewUrl` with one line: the counts, what the set does.
   The page shows every op's diff and the page after the change, rendered by the gateway;
   do not retell the diffs. Say what the human has to decide (the `warnings` and each op's
   `warnings`: a page that keeps AI out, tags already as asked, a page edited since an
   earlier run). The result has no diffs on purpose. Without a `reviewUrl` (a header or
   local connection) there is no page: show each op's `summary` and offer `get_page`.
3. **Wait for the approval the result's `note` names.**
   - `gate: "require"`: the human **presses Approve on the review page** (after a Microsoft
     sign-in from the last 10 minutes). A typed yes in the chat is not the approval and
     `apply_changeset` refuses without the button. Hand over the link and wait; when they say
     they approved, call `apply_changeset` **once**. If it answers "NOT WRITTEN: waiting",
     tell them; never poll or loop. A Reject on the page means do not apply: ask what to change.
   - `gate: "log"` or `"off"`: ask the human, as at any preview, for an explicit yes in the
     chat on exactly this set; the link is for reading it. (Approve on the page is recorded
     as `reviewedOn: "page"` but not required there.)
4. **Apply.** `apply_changeset {previewToken}` (`limit` up to 25 ops per call, default 10). It
   re-reads every target first and writes **nothing** if a page changed since the preview or
   is now closed to AI: preview again. Then it writes op by op and **stops at the first
   failure**: later ops are `not-run`, nothing is rolled back. While `complete` is false and
   nothing failed, call it again with the same token; a repeated call never writes an op twice.
5. **Record** at once, before anything else: the page ids of `created[]` and the run (below).
6. **A stopped run:** `next` says what to do. Same token again if the cause was temporary
   (BookStack down). If a page changed, or an op must change, `preview_changeset` again
   with the ops that are left and `resume: <runId>`: ops the run wrote are skipped, the new
   pages' ids are bound to the `draft:` links of the rest, and the human approves the smaller
   set again. After a gateway restart (previews and approvals are gone) the same `resume`
   continues from the run log on the server.
7. **Report:** the page urls, `created[]`, what failed and why, and how to go back: created
   pages are deleted by a person in BookStack (recycle bin); an edited page is restored to
   its `revisionBefore` in BookStack (page > Revisions). There is no undo tool for text edits.

## What the gate proves, and what it does not

The token proves what is written is exactly the set previewed (every op's text, target, tags,
order and page version). With Approve on the page (`gate: "require"`) it also proves that the
person whose Microsoft account made the preview pressed a button the model cannot press. It does not
prove they read every diff. A typed yes (`gate: "log"` / `"off"`) proves only that the chat
said yes: a client set to approve every tool call can say it for the human, which is why
the review link comes first. `reviewedOn` in the result says which of the two it was. Never
ask the human to type a yes as a substitute for the button when the gate requires it.

## Migration

For a migration the same flow applies to the verified drafts: see migrate-publish.md. The
state goes into `state.yaml` `changesets` and `published` (migrate-ledger.md).
