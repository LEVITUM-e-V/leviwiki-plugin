# Handling the coverage check

Read at Step M7. The `wiki-coverage-checker` agent gets one draft and the units
mapped to it (never the sources or the conversation) and answers with at most
8 items, recall losses first. It does not fix anything.

## The call

`leviwiki:wiki-coverage-checker` with: the page title, the draft markdown, and the
output of `check-ledger.mjs <job> --units-for <page key>`, pasted as printed:
the units placed on this page (with `origin`, `state`, `confirmed`), a KNOWN
EXCLUDED list (linked, dropped, secret units: subject and verdict, never a secret's
text) and, for a page that links recordings, PLANNED MEDIA (name and url of each). You don't read units.yaml. A page split from an existing page gets only
the units mapped to it, not the old page's whole text.
Without the Agent tool, make both passes yourself: every unit → where is it on
the page; every rule, value, limit or policy on the page → which unit holds it; and the
recordings on the page against PLANNED MEDIA.

**Media before drafting.** When `policies.media.mode` is `link`, every recording or deck to be linked is
resolved to its SharePoint URL **before the draft is written** (Microsoft 365 search by name; the
`ref` of a `search_wiki` OneDrive hit gives the file when the name is ambiguous) and the row gets `url`.
A recording that can't be found goes to the human in the Step M5 batch (decision, then `unresolved:
<decision id>` on the row); never leave it half linked. The script fails a draft that lacks a planned
recording's link or holds one the plan does not list.

## Handling each category

| Item | What it means | What you do |
|---|---|---|
| `[absent]` | A unit isn't on the page | Add it from the unit's text, or change the unit's verdict with a reason (drop, link-only), shown to the human |
| `[partial]` | Part of a unit is missing (a condition, a cell count) | Complete it from the unit's text |
| `[unsupported]` | The page states a rule or value no unit holds | Remove it, or ask the human; if they answer, append the answer as a unit (`origin: read`, source "human, <date>") so it is covered next time |
| `[conflict]` | The page contradicts a unit, or two units disagree | A page that merely drifted from its unit: fix the page to the unit. A **late conflict** (two units, a unit against a wiki page's value, or a decision the human made that the page now contradicts): append the other value as a unit with the shared `subject`, set `phase: reconcile` and send it to the human at Step M5; **never settle it in the draft** |
| `[inferred]` | The page rests on an inferred unit that isn't confirmed | The human confirms it (a decision, then `confirmed: <id>` on the unit), or it goes |
| `[excluded]` | The page states something left off on purpose | Remove it; a link to where it stays is fine |
| `[media]` | The linked recordings differ from PLANNED MEDIA in number or name ("there is no third video") | Add the missing link (its `url` is in the inventory row) or remove the extra one; if the plan itself is wrong, fix `media:` on the plan page and the media rows, not the draft alone |

A `[conflict]` is never "resolved" by choosing a value yourself: Claude may suggest, only the human decides
(`decided_by: user`). The draft waits for the decision, then goes through Step M7 again.

Over 8 problems: fix the first 8, call again, repeat. Run until it says
"Complete" or every remaining item is a decision the human made (note it in
`state.yaml`). Tell the human per page: how many items, how many fixed, what is left.

The checker is not the cold reader: the cold reader asks whether a stranger can
use the *page*; the checker asks whether the *units* are on it. Run both for a
new page over about 40 lines, the checker alone for a short one.

## After a change

When the human's answer or a preview change alters a draft, the answer becomes a unit first
(`origin: human`, `source: human`, appended with its counts), then the draft changes, then this
step and the script run again for that page, then its sha256 goes into `state.verified`
(`check-ledger.mjs <job> --hashes`). The script checks that hash from publish on.

## A lost unit found later

A unit missing from a published page: `preview_edit` with an `insert-section-after`
or `replace-section` op (reference/migrate-publish.md), `reviewed` false, not a rewrite.
