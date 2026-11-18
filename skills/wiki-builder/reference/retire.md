# Retiring a page (Step 8b)

A page that was merged into another, replaced or is obsolete is archived, not
left in place and not moved by hand. `preview_publish` (`op: update`) with
`status:deprecated` only sets the tag and can't move the page, and
`preview_structure_fix` refuses page moves. The tool is an `archive` row of
`preview_apply` / `apply_proposal` (steward tools): it moves the page to the
Deprecated pages book and sets `status:deprecated` itself.

**Order when pages link the old page: edit those pages first, archive last.** Moving a page to another
book (the archive) or renaming it makes BookStack rewrite full `/books/.../page/...` links to it on the pages
that link it and save a new revision of each (BookStack v26.09.2,
`app/References/ReferenceUpdater.php`; `/link/<id>` links are not rewritten). A preview you approved for
such a page before the archive is then refused as "edited since the preview". So do step 5 (Related links
and any text that names the old page) **before** step 4, and archive last; if you did it the other way,
`get_page` those pages again and preview again. A page that the human asked to "delete" is archived: say so in one line
(a real delete is never done here).

1. **Check the content.** `get_page` the old page and its replacement. Check
   that the replacement holds what is worth keeping.
2. **Check the steward tools are in your tool list** (`preview_apply`,
   `apply_proposal`, `preview_undo`; only members of the `LeviWiki-Stewards`
   group get them). If they are missing, do not shrink the page to a
   pointer. Instead mark it deprecated where it is with `preview_page_tags` /
   `apply_page_tags` (`set` `status:deprecated`), and/or give the human the
   archive row of step 4 ready-made, to hand to a steward. Stop there.
3. **Pointer text.** Shrink the old page's text to a pointer to the
   replacement with `preview_edit` (Step 8a): show the diff, yes,
   `edit_page`. Skip this for a `no-ai` page (its text is not readable; its
   place and tags still work).
4. **Archive.** `preview_apply` with a one-row proposal for `area: steward`,
   passed as a JSON object with the top-level wrapper, never YAML or a string
   (the fields are explained below this example):
   ```json
   {"area": "steward", "rows": [{
     "page_id": 123,
     "action": "archive",
     "shelf": "archive",
     "book": "deprecated",
     "type": "<the page's current type>",
     "also": ["<the page's current also: values>"],
     "subsystem": ["<the page's Area>"],
     "confidence": "high",
     "reason": "merged into / replaced by ..."
   }]}
   ```
   - Required: `area` (top level; `steward` for an archive row), `page_id`,
     `action: "archive"`, `shelf: "archive"`, `book` (see next item), `type`,
     `confidence` (`high`, `medium` or `low`) and `reason` (one line).
     `also` must be given too: the archive row replaces the page's `also:`
     wholesale, so copy its current values (an empty list if none) or they
     are dropped. `subsystem` (a list of 0-2 Area slugs from
     `get_wiki_structure`) is required for a page from an Area or Projects
     book, and not needed for a page from an Organisation book or one already
     in an archive book. `chapter` is optional; `title` is informational.
   - `book: deprecated` is the Deprecated pages book (slug in
     `get_wiki_structure`); use another
     archive book only if the page belongs to one.
   - An archive row replaces `type:`, `also:` and `subsystem:` wholesale:
     copy the page's current `also:` values or they are dropped.
   - `type` is required: if the page has no `type:` tag, choose one by the
     filing rules and say so in the reason.
   - `subsystem:` is needed for a page from an Area or Projects book; a page
     from an Organisation book, or one already in an archive book, needs none.
   - If the page keeps AI out only through its book's `no-ai`, add
     `"tags": {"add": ["no-ai"]}` to the row, or the preview refuses the move.
   - Show the preview (its warnings verbatim, and its `reviewUrl` when it has
     one); after a yes on exactly that preview,
     `apply_proposal {proposal, previewToken}` with exactly the previewed
     proposal. An error from the preview names the field to fix: fix the row
     and preview again. It never changes a page's text or `last-reviewed:`;
     `tags` refuses `status:` (the archive row sets `status:deprecated`).
   - To only mark a page deprecated where it is: `preview_page_tags` /
     `apply_page_tags`.
5. **Related links (do this before step 4).** Pages whose Related entries named the old page:
   `preview_edit` each to point at the replacement (one preview and one yes
   per page), or list them for the human. Then archive (step 4), last.

Report the run id. Undo is a steward tool of its own: `preview_undo {runId}`,
then after a yes on that preview `apply_undo {runId, previewToken}`. It
restores book, chapter and tags, but not the step-3 text edit (a separate
revision: restore it with `preview_edit` / the page's revision history).
