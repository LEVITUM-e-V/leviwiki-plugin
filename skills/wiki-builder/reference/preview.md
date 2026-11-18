# What the human sees before publishing

Read this at the confirm step. Same shape every time, so people learn where to look.

## The message

Same shape for `preview_edit` (the `summary` has one line per op, and a rename's old → new title with its notes; the diff shows the changed lines only, and is empty for a rename alone; chapter and tags stay; on a visual-editor page the preview also carries a `conversion` with the loss report, `textDiff` and `structureChanges`, which you show first, and the diff is against the converted markdown) and `preview_convert` (the `summary`, the `loss` report with any page includes it keeps as `{{@id}}` tags, the `textDiff` and the `structureChanges`; the human decides on the loss report and on both being empty). The same goes for `preview_link_titles` after a rename: its `summary`, every page's `diff` (only link text changes) and the pages listed for a person (`needsManualFix`). The question is then **Apply** (`edit_page` / `convert_page` / `update_link_titles`), **Change something** or **Cancel**.

0. **The review link.** When the preview result has a `reviewUrl`, give it first, with one line on what changes. It opens the exact preview (the diff, and the page as it would read) rendered by the gateway, after signing in with the same Microsoft account. For the previews above it is read-only, and the yes is still given here in the chat. A `preview_changeset` review page also has Approve and Reject buttons: see [changeset.md](changeset.md), which says when the button, and not a typed yes, is the approval. Don't retell the diff in your own words in place of the link; where the client can't show a link, or there is no `reviewUrl`, show the content as below.
1. The `summary` from `preview_publish`, exactly as returned (where it lands, type, tags, back-links, files).
2. Anything the human must decide or should know, one line each: `confidence:low` choices, `tagIssues`, a new chapter, a page in a restricted book, what was left out because it came from a restricted page, cold-reader questions you couldn't answer from the session.
3. The content:
   - **edit** (`preview_edit`, the way to change an existing page) **or deprecated update** (`preview_publish`): the whole `diff` from the preview (never cut it: the human approves exactly what it shows). An edit keeps the tags; an update replaces the page's tags with the draft's, so show `tagChanges` too. Offer the full page on request.
   - **convert:** the `summary`, the `loss` report (includes too), the `textDiff` and the `structureChanges` in full.
   - **create, short page (≈ 40 lines or less):** the markdown in a fenced block.
   - **create, longer page:** where the client can write files, the draft file (see below) plus the headings and the first section inline; otherwise the full markdown.
4. One question: **Publish**, **Change something** (say what), or **Cancel**. Use the client's multiple-choice question tool if it has one.

## Example

> **New page** "FC brownout when servo & logic share the BEC"
> **Where:** Avionics & Flight Control › Flight controller
> **Type:** note
> **Tags:** status:draft, validation:researched, safety; last-reviewed is set to today on publish
> **Back-links added to:** "BEC wiring", "Flight controller pinout"
>
> To decide: you bench-tested this on 12 Oct. Mark it `validation:tested`? Then I'll link the test log entry for that session.
> The reviewer asked which BEC part number; I added the one from our session.
>
> ```markdown
> ## The insight
> When the servos and the flight controller share one 5 V BEC, a servo stall …
> ```
>
> Publish, change something, or cancel?

## The draft file (clients with file access)

For a page longer than about 40 lines, also write the markdown to `~/.leviwiki/drafts/<slug>.md` and give its full path, so the human can read and edit it in their editor. Never write it into the current directory (often a code repository). If they edit it, read it back, preview again, and show the new summary: the old previewToken no longer matches.

## After publishing

Report the url, the back-links written (and any not written, with why), the attachments, and that the change can be undone from the page's Revisions in BookStack (an update, an edit, a conversion; a conversion that fails its read-back names the revision) or by deleting the page (a create).
