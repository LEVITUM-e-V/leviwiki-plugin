# Mode C: structure

The operator's structure build only adds. It never renames, retags or moves, and it stops (writes nothing) when a difference looks like one of those. The steward ops here do those, each time with both sides.

Needs `preview_tag_rename`/`apply_tag_rename` and `preview_structure_fix`/`apply_structure_fix`, which are steward tools too; if they're missing, tell the user as in "Before anything" and stop at the report.

1. **List.** `list_issues {check: "structure-drift"}` and `{check: "tag-vocabulary"}`. Each structure-drift finding has `data.class`:
   - **safe / permission:** nothing to do here; the structure build applies them at the end (step 7). A missing template flag has no API: the operator's structure build marks the template pages, or a person does it in BookStack.
   - **conflict:** work them below. A finding with `data.renameHint` says what the spec has and what the wiki has instead.
2. **A rename hint is a guess.** Show the human the pair ("the spec lists *Design & simulation*, the wiki has *Gestaltung*, `owner:gestaltung`") and ask: is it the same thing renamed? Only on a yes continue. On a no, it's a removal plus an addition: say so, and leave it for a person (the content in the old book is theirs to move; `preview_apply` can move pages).
3. **Fix a confirmed rename** with `preview_structure_fix {fixes}` (up to 20; fixes apply in order, so retag first; it refuses permissions, deletes, page moves and a book carrying `no-ai`):
   - book or Area: `retag_book {bookId, from: "owner:old", to: "owner:new"}` (or `book:`), then `rename_book {bookId, from, to}`. The pages' `subsystem:` (Area) or `project:` (prototype) values follow.
   - chapter: `rename_chapter {chapterId, from, to}`.
   - a book on the wrong shelf: `move_book {bookId, from, to}`, `from` and `to` being shelf kinds (`areas`, `projects`, `archive`, `organisation`).
   - The `to` is always what the spec says. If the spec is wrong, the spec changes, not the wiki: ask the wiki operator to update the structure spec and rebuild.
4. **Fix a tag** with `preview_tag_rename {from, to}` (`"status:approved"` → `"status:canonical"`, `"sensitive"` → `"no-ai"`; an empty `to` removes the tag). It refuses `owner:`, `book:` and `type:` and a `to` outside the vocabulary; `no-ai` and `sensitive` are renamed only to each other: the rename never lifts them. Pages that keep AI out are included, and their text is never read. Pages without `last-reviewed:` get one from their old edit date: tell the human, since the preview lists them.
5. **Show the whole preview** (steps, warnings, pages; a tag rename covers restricted pages too). Only on an explicit go: `apply_structure_fix` / `apply_tag_rename` with exactly the same input and the `previewToken`. Report `runId` and any failure. Pages edited since the preview come back as `changedMeanwhile` (tag rename) or `pagesChangedMeanwhile` (a `retag_book` step) and were left untouched: preview again for them. A structure fix stops at its first failed step. Any refusal: follow its message and preview again.
   - Undo: page tags of either op come back with `preview_undo {runId}` / `apply_undo`. A book, chapter or shelf step is not in that log: it is in `structure-fixes.jsonl` on the server, to put back by hand.
6. **Not yours, list for a person with exact instructions:** access (`restriction-open`, `book-no-ai-extra`: an admin in BookStack), duplicates, anything about a book that keeps AI out, removing a book or chapter with content (move its pages with a proposal first).
7. **Finish:** list again, then ask the wiki operator to update the structure spec and rebuild, so what is still missing gets built. A rename changes the slug of the book, so tell them links by slug break.
