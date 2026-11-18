# Renames, link titles and visual-editor pages

Read this from Step 8a for a rename, the link titles after a rename, or a page
with `format: html`. Every write still needs a yes on exactly its preview; a
change means a new preview.

## Rename
`title` in `preview_edit`, alone or with ops. Sentence case, as the filing
rules ask. Show the old and new title and the notes (the slug address
changes; the pages whose links show the old title, and those a person
fixes). A rename alone works on any page, a visual or `no-ai` one too,
without reading its text, and doesn't set last-reviewed (nor does
`preview_convert`: converting isn't a review).

## Link titles after a rename
When `edit_page` returns `next`, offer to update those links:
1. `preview_link_titles {pageId, oldTitle, oldSlug}` (all three from
   `next`). It changes only link text that is exactly the old title, in
   Related and inline.
2. Show the summary and every page's `diff`, and name the pages under
   `needsManualFix` (`no-ai`, visual editor, links with formatting or in
   headings) for a person.
3. After a yes: `update_link_titles` with the same three and the
   `previewToken`.
- Pages in `changedMeanwhile`: preview again.
- `notExamined`: say so, and offer to run it again after this update.
- These writes aren't in the restructure undo log: a page goes back by
  restoring its previous revision in BookStack.

## `html` (visual editor)
**To change its text, call `preview_edit {pageId, ops}` as for any page:** on
a visual page the preview converts it first and applies the ops to the
converted markdown, and one `edit_page {previewToken}` writes both. The
preview shows the conversion's loss report first (what stays raw HTML,
such as draw.io diagrams, callouts and styled tables; what is dropped;
`conversion.textDiff` and `conversion.structureChanges`, both should be
empty), then the edit's diff. Show the loss report and ask for one yes
on the whole preview; nothing is refused for what the conversion keeps or
drops. No last-reviewed is set (converting isn't a review). The page is read
back after the write; a warning names the revision to restore. `gfmTables:
true` works as below, only if the human asks.

**To convert without editing**, or to look at the result first:
1. `preview_convert {pageId}`.
2. Show the summary; the loss report (what stays raw HTML: styled tables,
   callouts, headings with images, embeds; tables with column widths become
   markdown tables only if the human asks, with `gfmTables: true`, which
   drops the widths); the `textDiff` and `structureChanges` (links, image
   sources, code; both should be empty); and any `{{@id}}` includes kept as
   tags.
3. After a yes: `convert_page {previewToken}`. Name, tags and chapter stay;
   it reads the page back and names the revision to restore if the text
   differs.
4. Later edits are plain `preview_edit` calls as in Step 8a.

A draw.io diagram (`<div drawio-diagram="ID">`) stays in the markdown as that
raw HTML block, so it stays editable in BookStack's markdown editor.
