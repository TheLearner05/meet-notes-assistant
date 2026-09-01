# Pause/resume, remembered speaker names, and automatic Microsoft 365 export

## Goal

Close the deferred V1 pause/resume gap, make speaker renaming reuse names typed in past meetings, and automatically publish every finished meeting into a single running Word document and a shared task-tracking Excel workbook in the user's Microsoft 365 (OneDrive) account, with an AI step that decides whether each action item is a new task or an update to one already tracked.

## Decisions

- **Pause/resume** stays entirely client-side. The server never learns a meeting was paused — chunk uploads simply stop and resume; `MeetingRecord.status` stays `'recording'` throughout.
- **Speaker memory** is name-recall, not voice recognition. There is no audio fingerprinting anywhere in this pipeline, so "remembering a speaker" cannot mean automatic re-identification. It means every name ever entered in a rename is offered as an autocomplete suggestion the next time a speaker is renamed, on any meeting.
- **Microsoft auth** uses `@azure/msal-node`'s `ConfidentialClientApplication`, structurally parallel to the existing `google-docs.ts`. The user creates their own Azure AD (Entra ID) app registration (same category of one-time setup as the existing Google Cloud OAuth client) with `Files.ReadWrite` + `offline_access` scopes and redirect URI `http://localhost:8787/api/microsoft/callback`. Tokens are stored the same way as the Google token: a local JSON file under the data directory, never in source control.
- **Word export regenerates, it does not append.** Graph's file API treats `.docx` as an opaque blob; there is no incremental "insert text at end" call the way Google Docs' `batchUpdate` provides. Every export rebuilds the entire running document from `meetings.json` (every `ready` meeting's best report, chronological order) using the `docx` package, then overwrites the OneDrive file in one upload. This makes export naturally idempotent and self-healing — a bad prior export is never compounded.
- **Excel export is real incremental table editing**, via Graph's tabular Excel API (`workbook/tables/{id}/rows`), because that API is actually structured (unlike Word). One workbook, one `Tasks` table: `Task | Owner | Due Date | Status | Source Meeting | Date Added | Last Updated | Comments`. Bootstrapped on first use by uploading a header-only workbook (built locally with `exceljs`) if the configured file doesn't exist yet, then wrapping the header row in a Table via the Excel API.
- **Task matching is AI-decided**, scoped deliberately narrow: the matcher reasons only over the current meeting's own extracted `actionItems` against the sheet's currently-open rows, classifying each as `new` or `update: <row>` and generating both the auto-written comment and (since the user asked for this explicitly) a status change when the item reads as completed. It does not re-scan full transcripts hunting for offhand mentions of unrelated older tasks — that scope would multiply cost and misfire risk for a case the user didn't ask for.
- **The app owns the Comments column outright.** Per explicit user decision, an automatic update can overwrite a hand-typed comment in that column. This is a known, accepted trade-off, not an oversight.
- **Export triggers once, at the meeting's final, most-complete state** (`processingStage === 'final_ready'`, or when final diarization has definitively failed and the provisional report is what remains) — never after the fast/provisional pass, which has generic "Speaker pending" labels and rougher action items. This mirrors the existing `bestReport()` precedence already used by the dashboard and `reportAsMarkdown()`.
- **Export failure never fails the meeting.** A broken OneDrive connection is tracked on the meeting (`microsoftExportError`) but must never flip `status` to `'failed'` — the transcript and report are already valid without it.
- **Idempotency:** each meeting records which Excel row(s) it already created or updated (`taskRowRefs`), so re-running export for the same meeting (e.g. after a manual retry of final processing) never double-adds a task row. The Word regenerate-from-source approach is idempotent by construction.

## Pause/resume — user flow

1. New `PAUSE_RECORDING` / `RESUME_RECORDING` message types alongside the existing `START_RECORDING` / `STOP_RECORDING` in `background.ts`.
2. `offscreen.ts` calls `recorder.pause()` / `recorder.resume()` on the existing `MediaRecorder` instance — no new stream, no new server call.
3. `recording-session.ts` tracks a `paused` boolean alongside the active tab id, so a service-worker restart mid-pause is recovered the same way an active recording already is.
4. Popup/recording banner gets a Pause/Resume control next to Stop, and the banner text distinguishes "Recording" from "Paused".

## Speaker memory — user flow

1. New small store `apps/server/src/known-speakers.ts` (same shape as `MeetingStore` but a flat deduplicated name list) persisted to `data/known-speakers.json`.
2. The existing `PATCH /api/meetings/:id/speakers` handler adds every non-empty renamed value to this store after applying the rename.
3. `GET /api/known-speakers` exposes the current list.
4. The dashboard's speaker-rename UI (wherever it's added — currently there's no rename UI in `index.html` at all, so this ships a minimal one: click a speaker label in the transcript or speaker-report section to rename it) uses a `<datalist>` populated from that endpoint for autocomplete. No automatic matching, no confidence scores — purely a typing shortcut.

## Microsoft 365 export — data flow

1. Once a meeting reaches its final ready state, `queueProcessing`'s existing fire-and-forget pipeline (after `processFinalDiarizedMeeting`) calls a new `exportToMicrosoft365(store, meeting.id, dataRoot)` in `apps/server/src/microsoft-export.ts`. Skips silently (no error recorded) if Microsoft isn't connected yet, mirroring how Google export is opt-in today.
2. **Word:** load every `ready` meeting from the store, build the full running document text (same section order as `reportAsMarkdown`/`buildGoogleDocText`: summary, decisions, action items, speaker report, transcript, per meeting), render it with `docx`, upload via Graph's simple content `PUT` to the configured OneDrive path.
3. **Excel:** read current `Tasks` table rows via Graph, send the meeting's `actionItems` plus the open rows to OpenAI (same `chat.completions.create` pattern as `reporting.ts`'s `summarize`) with a strict JSON response shape (`{ operations: [{ type: 'new'|'update', task, owner, dueDate, status, comment, rowIndex? }] }`), then apply: `POST .../rows/add` for `new`, `PATCH .../rows/itemAt(index)` for `update`. Record the resulting row indexes on the meeting as `taskRowRefs`.
4. Both steps are independent — a Word failure doesn't block the Excel step or vice versa; each records its own error independently.

## Configuration

- `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID` (or `common` for personal accounts), `MICROSOFT_REDIRECT_URI` (defaults to `http://localhost:8787/api/microsoft/callback`), matching the existing `GOOGLE_CLIENT_ID`-style env vars.
- `MICROSOFT_WORD_PATH` and `MICROSOFT_EXCEL_PATH` — OneDrive paths (e.g. `/Meeting Reports/Running Report.docx`, `/Meeting Reports/Tasks.xlsx`) the user configures once.

## Verification

- Unit tests: Word document text assembly (pure function, same shape as `buildGoogleDocText`), the task-matching prompt/response parsing (pure function taking a fake AI response), the known-speakers store (dedup, persistence), pause/resume message handling in the extension's existing mocked-Chrome-API test style.
- No live Graph or Azure calls in tests — same convention as `google-docs.test.ts`, which only tests `buildGoogleDocText` and never calls the real Google API.
- Manual acceptance test (once the user supplies Azure credentials): connect Microsoft, process one meeting, confirm the Word doc contains it and the Excel sheet gets a new task row with a comment; process a second meeting whose action items reference the first meeting's open task, confirm it updates that row instead of duplicating it.
