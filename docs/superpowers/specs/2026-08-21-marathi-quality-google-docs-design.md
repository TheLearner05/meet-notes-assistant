# Marathi quality, resilient long-meeting processing, and Google Docs setup

## Goal

Make the local Google Meet assistant produce materially better Marathi, Hindi, Hinglish, and mixed-language transcripts; publish complete initial notes promptly after a meeting ends; retain an accurate speaker-labelled report when it is ready; and make a personal Google account able to export a report to Google Docs after a one-time local setup.

## Decisions

- Replace ordinary transcription with OpenAI's current `gpt-transcribe` model. Use it for all initial transcription, rather than `gpt-4o-transcribe`.
- Convert the user's language choice into explicit expected-language hints: Marathi meetings use `mr`, Hindi meetings use `hi`, and mixed meetings allow `mr`, `hi`, and `en`. The request also includes a small editable vocabulary of names, product terms, and acronyms.
- Keep `gpt-4o-transcribe-diarize` only for final speaker labelling. It is not used to create the first transcript.
- Split reconstructed audio into short, valid WebM sections. Initial transcript sections run with bounded parallelism and retry transient failures. Speaker-analysis sections use a shorter duration, bounded parallelism, and retry/continue handling so a single slow request cannot discard the report.
- Initial notes and final speaker analysis remain visibly distinct. The dashboard shows progress, elapsed processing phase, and whether a retry is safe.
- Google Docs export remains entirely local. It requires a Google Cloud OAuth client and a normal personal Google account; the app provides a setup page and clear connection status but never embeds shared OAuth credentials in the extension.

## User flow

1. Before recording, the user chooses Auto, Marathi, Hindi, or English. Marathi and Hindi choices provide the corresponding language guidance to the model; Auto uses the three expected languages.
2. The extension records only the active Meet tab and uploads its audio locally as before.
3. At meeting end, the local server reconstructs the audio into valid sections. It transcribes the sections in parallel with `gpt-transcribe`, using language hints and saved vocabulary.
4. The dashboard publishes complete initial notes as soon as the ordinary transcription and summary finish. It clearly says that speaker labels are still in progress.
5. Speaker analysis runs in the background with separately retryable short sections. If it cannot complete, the accurate initial transcript remains available and the dashboard offers a non-destructive retry.
6. The user opens Settings, pastes/imports their own Google OAuth desktop-client details, and chooses Connect Google. The browser consent flow stores the Google token only under the local app data directory. The Export button then creates a document in that user's Google Drive.

## Performance and reliability

- The initial-notes target is a few minutes for a two-hour meeting when the user's OpenAI rate limit permits it. The app must never claim a fixed two-minute guarantee.
- Audio work runs with configurable, conservative parallelism. Rate-limit and timeout failures are retried with backoff; an individual final section can be retried without losing already-completed sections.
- The server records a per-stage count (completed, total, retrying) and exposes it to the dashboard. A meeting cannot remain shown as recording after its recording session ends.
- Source audio remains local until the configured retention deadline. The OpenAI API receives only the selected audio sections required for transcription.

## Google Docs constraints

- Google Docs API and OAuth credentials must be created in the user's own Google Cloud project. A personal Google account is supported; no Google Workspace subscription is required.
- The required redirect address is `http://localhost:8787/api/google/callback`.
- Credentials and access tokens must remain out of source control and extension bundles.

## Verification

- Unit tests cover language-hint mapping, vocabulary serialization, section-level retry/backoff decisions, bounded concurrency, and progress updates.
- Integration tests cover a long recording where one final diarization section times out and a subsequent retry completes only that section.
- Google configuration tests cover missing credentials, locally saved credentials, OAuth URL generation, and connection status without exposing secrets.
- Manual acceptance test uses a Marathi/Hindi/English recording with known vocabulary, verifies the initial transcript before final speaker labels, and exports the final report to a personal Google Doc.
