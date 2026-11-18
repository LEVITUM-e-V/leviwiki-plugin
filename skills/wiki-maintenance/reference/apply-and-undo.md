# Apply and undo (Mode B, step 6)

The hard rules stay in SKILL.md: apply only after an explicit go on that exact preview, with exactly the previewed proposal and `previewToken`; undo only after the human's go on its own preview.

- It applies up to 25 pages per call. While `remaining` is above 0, call it again with the same proposal and `previewToken`; the token lasts 8 hours by default.
- Report `runId`, `applied`, `alreadyDone`, `skipped` (skip rows), `failed[]` and `chaptersCreated`. A 403 in `failed[]` means the person's role may not delete pages, which BookStack requires for moves.
- Append one line to `~/.leviwiki/restructure/runs.log`: date, Area, runId, counts.
- Undo: `preview_undo {runId}` (or `{pageId}` for one page's latest change, or `{area}` for every run of an Area) then, after the human's go on that preview, `apply_undo` with the same input and `previewToken`; give the human its `reviewUrl`. It restores pages and tags under their own token, only where the page is still as the run left it, and reads no page's text, `no-ai` pages included. A page whose tags it can't check without the text, or one saved while the undo runs, comes back as a conflict, left as it is. It compares place and tags only, so a page whose text alone was edited since the run is restored too: tell the human, as the preview's `note` says. It never deletes: an empty chapter the run created is listed in `chaptersKept` for the human to delete in BookStack. (The server command `undo` in the restructure container also deletes it, under the restructure token.)
