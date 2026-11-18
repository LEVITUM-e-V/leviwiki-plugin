# Files: staging, extraction, attachment

Read this when the material includes a file (datasheet, log, CSV, image, CAD, slide deck) or a link to one.

Every file becomes a BookStack attachment on a searchable stub page; the stub's text is what search finds. Stage the file first — nothing is written to the wiki yet:

- **Tool `stage_file` available (laptop install):** call it with the file's path. It hashes and checks the file and returns its sha256.
- **Tool `request_upload` available (hosted):** compute the file's sha256 and size in bytes yourself first (it does not hash anything for you), call it, then PUT the bytes to the returned `uploadUrl` with exactly `requiredContentType` as Content-Type, e.g. `curl -T <file> -H 'Content-Type: <requiredContentType>' <uploadUrl>`. The URL works once; a 400 means the bytes didn't match what you declared — request a new URL. `alreadyStaged: true` means skip the PUT. If you cannot run a command to PUT the file, say so and suggest the laptop install — never paste file contents into a tool call instead.

Staged files wait 8 hours by default, like a preview (the operator can change it; the preview's files line says how long). `preview_publish` checks that each listed hash is staged and names the ones that aren't (`filesNotStaged`): stage those before the human's yes. List every file's sha256 in the draft's `assetHashes`: `publish_page` attaches exactly those, and nothing else can be attached under that preview.

Then `extract_asset` (sha256 + kind) for datasheet/slides/tabular/log to get text back, and by kind:

- **Datasheet (PDF):** `extract_asset` (kind: datasheet) → reference stub (`asset:datasheet`) + key specs in the At-a-glance table; the PDF is attached.
- **Log:** `extract_asset` (kind: log) → note/reference summary (`asset:log`); for a test session draft the summary from the `log` template and name the attached file under Raw data. NEVER embed the raw log.
- **Spreadsheet or table (`asset:tabular`: csv, tsv, xlsx):** csv/tsv → `extract_asset` (kind: tabular); small → table; large → summary + attached file. xlsx has no extractor (the call refuses it): attach it, describe its sheets and purpose only from what the user tells you, or have them export the sheet to csv. Never tag a spreadsheet `asset:csv`; that is the deprecated name and gets retagged.
- **Pasted image:** describe what you actually SEE (do not invent values); put the image in the page (base64 in the markdown auto-extracts to the gallery); the description is the searchable text.
- **CAD/binary:** reference stub (`asset:cad`) with name/revision/subsystem — no extractor for these; describe from what you already know.
- **Slide deck (.pptx):** `extract_asset` (kind: slides) → extract durable items into their homes; create ONE dated meeting-record page linking them; attach the deck to the meeting record. Extract only what slides state; flag inferred items `confidence:low`.
- **OneDrive/SharePoint link:** reference stub linking the file where it lives (no staging, no attachment) — describe only what the user tells you or what search returned; it stays editable in OneDrive.
- **GitHub repo:** reference stub in the owning Area linking the repo (`source:github`); do NOT copy the README in — the repo is the source of truth and the indexer ingests its docs directly.

After publishing: `publish_page` reports each file in `attachments`. One with `attached: false` (usually expired) is staged again and then attached with `attach_file {pageId, sha256, previewToken}` — the same token, no new preview needed as long as the hash was in the confirmed draft.
