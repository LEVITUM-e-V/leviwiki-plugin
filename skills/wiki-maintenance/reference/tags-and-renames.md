# Tags without a move, renames and link titles

Read when an issue is fixed by a tag change in place, a rename, or stale link text. The hard rules stay in SKILL.md: write only after an explicit go on the exact preview.

## Tags without a move

`preview_page_tags {edits: [{pageId, add, remove, set}]}` (up to 50 pages; `add`/`remove` are "name" or "name:value", a bare name in `remove` takes off every value, `set` replaces every value of each tag name it gives) → yes on the exact list → `apply_page_tags` with the same edits and the `previewToken` (8 hours by default).
- Member tools: no steward group needed. Works on `no-ai` pages too (metadata only).
- Use it for `status:deprecated` where the page is, a `subsystem:` added, a stray tag off. To deprecate *and* archive, use an `archive` row.
- Refused: `owner:`/`book:`, `last-reviewed:` (`mark_reviewed`), the validator's `needs-review` reasons, lifting `no-ai`, a page left without `type:`, a value outside the vocabulary. A page without `last-reviewed:` gets one from its old edit date (the write isn't a review): the preview lists it.
- Returns `changes`, `unchanged`, `reviewUrl`; apply returns `runId`, `applied`, `failed`, `changedMeanwhile` (pages edited since the preview, left alone: preview again). Undo: `preview_undo {runId}` (steward).

## Renames

A page title changes with `preview_edit {pageId, title}` → yes → `edit_page`, never a proposal row. A rename alone reads no text, works on `no-ai` pages, and stamps nothing (renaming isn't a review).
- The same preview can carry a text edit, `tags: {add, remove, set}` and `reviewed`. `reviewed: true` sets `last-reviewed` to today: pass it only when the human confirmed the **whole page** is still accurate; otherwise `last-reviewed` stays (a page without one gets its previous save date).
- A visual-editor page is converted and edited in the same preview; `tags` and `reviewed` are refused there (then `preview_page_tags` / `mark_reviewed`).
- The preview lists the other pages whose links show the old title. When `edit_page` returns `next`: `preview_link_titles {pageId, oldTitle, oldSlug}` → yes on the list and the diffs → `update_link_titles` with the same three and the token (8 hours by default).
  - Only a markdown link to the page whose whole text is exactly the old title changes. Links with other text are left alone. `no-ai` and visual-editor pages, and links with formatting, in headings, as `[..][]` references or in a table cell, come back in `needsManualFix` for a person.
  - At most 300 pages are examined; the rest come back in `notExamined`: narrow `oldTitle`, or run it again after the update.
  - A page renamed earlier: take the old title (and slug) from its revisions.
  - A page without `last-reviewed:` gets one from its old edit date; the write isn't a review. Pages saved between plan and write come back as `changedMeanwhile`: preview again.
  - These writes are **not** in the restructure undo log (`preview_undo`): a page goes back by restoring its previous revision in BookStack.
