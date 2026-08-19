# Google Meet Meeting Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a private Google Meet Chrome extension and web app that records only after user confirmation, produces a Hindi/Marathi/English speaker-aware meeting report with OpenAI, and exports it to Google Docs.

**Architecture:** A Manifest V3 Chrome extension detects an active Google Meet and, only after a button click, captures its tab audio through an offscreen document. It uploads short encrypted chunks directly to object storage using server-issued upload URLs. A Next.js application stores metadata in PostgreSQL, queues processing work, submits the assembled audio to OpenAI for diarized transcription and report generation, then exposes the report in a private dashboard and exports it through Google Docs OAuth.

**Tech Stack:** TypeScript, pnpm workspace, Next.js, React, Chrome Extension Manifest V3, Vite, PostgreSQL, Prisma, Redis + BullMQ, S3-compatible object storage, OpenAI API, Google Identity Services / Google Docs API, Vitest, Playwright.

**Spec:** `C:\Users\jayhe\Documents\Codex\2026-08-19\we-x20\outputs\meeting-assistant-feature-list.md`

## Global Constraints

- Google Meet is the only supported meeting platform in Version 1.
- Audio capture starts only after the user clicks **Start recording**; no automatic or hidden recording.
- The recorder always exposes visible recording status and a consent reminder.
- Version 1 produces its report after the meeting, not a live transcript.
- Supported meeting-language choices are Hindi/Hinglish, Marathi/Marathi-English, English, and auto-detect.
- Preserve the original-language transcript and produce an English report.
- Use OpenAI for diarized transcription and report generation.
- Raw audio is deleted after successful processing by default; a meeting owner may delete every related record at any time.
- Speaker labels are editable and are never represented as certainly correct when model confidence is low.

---

## File Structure

```text
apps/
  extension/                 Chrome extension: Meet detection, consent UI, capture, upload
  web/                       Next.js web app: auth, API, dashboard, report and Docs export
  worker/                    BullMQ worker: assemble audio, OpenAI processing, retention cleanup
packages/
  contracts/                 Shared Zod schemas and TypeScript API/report types
  test-fixtures/             Synthetic audio/report fixtures; never real meeting recordings
infra/
  docker-compose.yml         Local PostgreSQL, Redis and MinIO development services
```

## Milestone 1 — Foundation and secure meeting lifecycle

### Task 1: Create the workspace and local services

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.env.example`
- Create: `infra/docker-compose.yml`
- Create: `packages/contracts/src/meeting.ts`, `packages/contracts/src/meeting.test.ts`, `packages/contracts/package.json`

**Interfaces:**
- Produces `MeetingStatus = 'recording' | 'uploading' | 'processing' | 'ready' | 'failed' | 'deleted'`.
- Produces `MeetingLanguage = 'hi-en' | 'mr-en' | 'en' | 'auto'`.
- Produces `CreateMeetingInput` validated by `createMeetingInputSchema`.

- [ ] **Step 1: Write the failing contract test.**

```ts
import { createMeetingInputSchema } from './meeting';

it('accepts a Marathi-English meeting and rejects an unknown language', () => {
  expect(createMeetingInputSchema.parse({ language: 'mr-en', source: 'google-meet' }))
    .toMatchObject({ language: 'mr-en' });
  expect(() => createMeetingInputSchema.parse({ language: 'fr', source: 'google-meet' }))
    .toThrow();
});
```

- [ ] **Step 2: Run `pnpm --filter @meeting/contracts test` and confirm it fails because the package and schema do not exist.**
- [ ] **Step 3: Define the Zod schemas and types.**

```ts
export const createMeetingInputSchema = z.object({
  source: z.literal('google-meet'),
  language: z.enum(['hi-en', 'mr-en', 'en', 'auto']),
});
export type CreateMeetingInput = z.infer<typeof createMeetingInputSchema>;
```

- [ ] **Step 4: Add the root scripts `test`, `typecheck`, and `lint`; start PostgreSQL, Redis, and MinIO via Docker Compose; run the contract test and typecheck.**
- [ ] **Step 5: Commit `chore: scaffold meeting assistant workspace`.**

### Task 2: Implement accounts, meetings, and deletion-safe data model

**Files:**
- Create: `apps/web/prisma/schema.prisma`, `apps/web/src/server/meetings/repository.ts`, `apps/web/src/server/meetings/repository.test.ts`
- Create: `apps/web/src/server/auth/require-user.ts`
- Modify: `packages/contracts/src/meeting.ts`

**Interfaces:**
- Consumes: `CreateMeetingInput` from `@meeting/contracts`.
- Produces: `MeetingRepository.create(ownerId, input): Promise<Meeting>` and `MeetingRepository.softDelete(ownerId, meetingId): Promise<void>`.
- `Meeting` has `ownerId`, `status`, `language`, `rawAudioDeleteAfter`, and no transcript/audio content in browser-facing list responses.

- [ ] **Step 1: Write a repository test using a temporary PostgreSQL database.**

```ts
it('allows only the owner to mark a meeting deleted', async () => {
  const meeting = await repository.create('user-a', { source: 'google-meet', language: 'hi-en' });
  await expect(repository.softDelete('user-b', meeting.id)).rejects.toThrow('NOT_FOUND');
  await repository.softDelete('user-a', meeting.id);
  await expect(repository.getForOwner('user-a', meeting.id)).resolves.toMatchObject({ status: 'deleted' });
});
```

- [ ] **Step 2: Run the test and confirm it fails before Prisma schema/repository implementation.**
- [ ] **Step 3: Add Prisma models `User`, `Meeting`, `AudioChunk`, `TranscriptSegment`, `Speaker`, `Report`, and `GoogleDocumentExport`.**
- [ ] **Step 4: Implement owner-scoped repository queries. Set `rawAudioDeleteAfter` to 24 hours after creation, with deletion accelerated after a successful report.**
- [ ] **Step 5: Run migration, repository tests, and `pnpm typecheck`; commit `feat: add private meeting lifecycle`.**

### Task 3: Build Meet detection and consent-first extension UI

**Files:**
- Create: `apps/extension/manifest.json`, `apps/extension/src/background.ts`, `apps/extension/src/content/meet-detector.ts`
- Create: `apps/extension/src/popup/App.tsx`, `apps/extension/src/popup/App.test.tsx`
- Create: `apps/extension/src/shared/messages.ts`

**Interfaces:**
- Produces `MeetState = 'not-meet' | 'lobby' | 'in-call' | 'ended'` from `getMeetState(url, document)`.
- Produces `START_RECORDING` only from a popup button click, never from the content script.
- The extension asks about recording only for `https://meet.google.com/*` tabs in `in-call` state.

- [ ] **Step 1: Write detector tests with static DOM fixtures for lobby, active call, and non-Meet URLs.**

```ts
it('marks an active Meet call as in-call', () => {
  const dom = new DOMParser().parseFromString('<div data-meeting-active="true"></div>', 'text/html');
  expect(getMeetState('https://meet.google.com/abc-defg-hij', dom)).toBe('in-call');
});
```

- [ ] **Step 2: Run the extension unit tests and confirm the detector import fails.**
- [ ] **Step 3: Implement a resilient detector using URL matching plus a small set of semantic/ARIA selectors; return `lobby` rather than `in-call` when uncertain.**
- [ ] **Step 4: Add the popup with language selector, consent text, and disabled Start button unless `MeetState` is `in-call`. The content script must not have capture permissions or a start-capture call.**
- [ ] **Step 5: Run unit tests, load the unpacked extension in Chrome, open a Meet lobby and active test call, and commit `feat: prompt before Google Meet recording`.**

## Milestone 2 — Audio capture, upload, and OpenAI processing

### Task 4: Capture tab audio only after user action and upload recoverable chunks

**Files:**
- Create: `apps/extension/src/offscreen/recorder.ts`, `apps/extension/src/offscreen/recorder.test.ts`
- Create: `apps/extension/src/background/capture-controller.ts`
- Create: `apps/web/src/app/api/meetings/route.ts`, `apps/web/src/app/api/meetings/[id]/uploads/route.ts`
- Create: `apps/web/src/server/storage/object-store.ts`, `apps/web/src/server/storage/object-store.test.ts`

**Interfaces:**
- Consumes: a `START_RECORDING` message from the popup and active Chrome tab id.
- Produces: `RecorderState` events: `recording`, `paused`, `stopped`, `error`.
- Produces: owner-scoped presigned chunk upload URLs; object keys have the form `meetings/{meetingId}/chunks/{sequence}.webm`.

- [ ] **Step 1: Write recorder tests with a mocked MediaRecorder that assert no `chrome.tabCapture` call occurs before `start(tabId)` is called.**

```ts
it('does not capture until start is explicitly invoked', async () => {
  const recorder = createRecorder(mockTabCapture);
  expect(mockTabCapture).not.toHaveBeenCalled();
  await recorder.start(42);
  expect(mockTabCapture).toHaveBeenCalledWith(expect.objectContaining({ audio: true }));
});
```

- [ ] **Step 2: Run the test and confirm it fails.**
- [ ] **Step 3: Implement the offscreen document recorder with `MediaRecorder`, 30-second WebM chunks, and local IndexedDB queueing until each chunk receives an upload acknowledgement.**
- [ ] **Step 4: Implement authenticated API routes that create one meeting and return short-lived upload URLs. Reject non-owner writes and files outside the WebM size limit.**
- [ ] **Step 5: Test intentional network disconnect/reconnect, recording stop, and retry; run unit tests; commit `feat: capture and upload Meet audio safely`.**

### Task 5: Assemble audio and generate a diarized transcript

**Files:**
- Create: `apps/worker/src/jobs/process-meeting.ts`, `apps/worker/src/jobs/process-meeting.test.ts`
- Create: `apps/worker/src/services/openai-transcription.ts`, `apps/worker/src/services/openai-transcription.test.ts`
- Create: `apps/worker/src/services/audio-assembler.ts`
- Modify: `apps/web/src/server/meetings/repository.ts`

**Interfaces:**
- Consumes: `ProcessMeetingJob = { meetingId: string }` after final upload.
- Produces: `DiarizedSegment = { speakerLabel: string; startSeconds: number; endSeconds: number; text: string }[]`.
- Uses the OpenAI transcription endpoint with `model: 'gpt-4o-transcribe-diarize'`, `response_format: 'diarized_json'`, and automatic server-side voice activity chunking.

- [ ] **Step 1: Write a job test with a fake object store and fake OpenAI client.**

```ts
it('stores speaker-labelled segments and marks a meeting ready for reporting', async () => {
  fakeOpenAI.transcribe.mockResolvedValue([{ speakerLabel: 'A', startSeconds: 0, endSeconds: 4, text: 'नमस्कार टीम' }]);
  await processMeeting({ meetingId: seededMeeting.id });
  await expect(repository.listSegments(seededMeeting.id)).resolves.toEqual([
    expect.objectContaining({ speakerLabel: 'A', text: 'नमस्कार टीम' }),
  ]);
});
```

- [ ] **Step 2: Run the job test and confirm it fails.**
- [ ] **Step 3: Implement assembly, compression/chunking under the transcription upload limit, and explicit status transitions: `uploading → processing → ready` or `failed`. Preserve the source audio on failure for retry.**
- [ ] **Step 4: Implement the OpenAI adapter so it is the only module holding the API client and map API segments into `DiarizedSegment`. Persist no API key in extension code.**
- [ ] **Step 5: Run tests with Marathi, Hindi, and English synthetic fixtures; queue a local job; commit `feat: create diarized meeting transcripts`.**

### Task 6: Generate structured reports and speaker statistics

**Files:**
- Create: `packages/contracts/src/report.ts`, `packages/contracts/src/report.test.ts`
- Create: `apps/worker/src/services/report-generator.ts`, `apps/worker/src/services/report-generator.test.ts`
- Create: `apps/worker/src/services/speaker-stats.ts`, `apps/worker/src/services/speaker-stats.test.ts`

**Interfaces:**
- Produces `MeetingReport = { summary: string; decisions: string[]; actionItems: ActionItem[]; openQuestions: string[]; speakerStats: SpeakerStat[] }`.
- `ActionItem = { text: string; ownerSpeakerLabel?: string; dueDate?: string | null }`.
- A report generator must return `dueDate: null` when the transcript does not explicitly state a due date.

- [ ] **Step 1: Write schema and calculation tests.**

```ts
it('does not invent an action-item due date', () => {
  expect(meetingReportSchema.parse({ ...validReport, actionItems: [{ text: 'Send quotation', dueDate: null }] }))
    .toBeTruthy();
});
it('sums speaking time from each diarized segment', () => {
  expect(calculateSpeakerStats([{ speakerLabel: 'A', startSeconds: 0, endSeconds: 12, text: 'x' }]))
    .toEqual([{ speakerLabel: 'A', talkSeconds: 12 }]);
});
```

- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement transcript-to-report prompting that requires evidence from the transcript, preserves unknown owners/dates as null, and requests an English report while leaving transcript text untouched. Validate model output with `meetingReportSchema`.**
- [ ] **Step 4: Save the report and speaker statistics in the repository. On validation failure mark the meeting `failed` with a retryable processing error.**
- [ ] **Step 5: Run report generator tests and commit `feat: generate meeting decisions and actions`.**

## Milestone 3 — Private dashboard, Google Docs, and reliability

### Task 7: Display, edit, search, and delete meeting reports

**Files:**
- Create: `apps/web/src/app/meetings/page.tsx`, `apps/web/src/app/meetings/[id]/page.tsx`
- Create: `apps/web/src/components/MeetingReport.tsx`, `SpeakerNameEditor.tsx`, `DeleteMeetingButton.tsx`
- Create: `apps/web/src/app/api/meetings/[id]/route.ts`, `apps/web/src/app/api/meetings/[id]/speakers/route.ts`
- Create: `apps/web/e2e/meeting-report.spec.ts`

**Interfaces:**
- Consumes: only owner/team-authorized `Meeting` and `MeetingReport` objects from server components or authenticated API routes.
- Produces: editable speaker names and full report deletion.
- Search accepts `q`, `from`, `to`, `speakerId`; it searches only meetings accessible to the current user.

- [ ] **Step 1: Write a Playwright test that creates a meeting fixture, edits “Speaker A” to “Aditi”, searches for a known action item, then deletes the meeting.**

```ts
await page.getByRole('button', { name: 'Rename Speaker A' }).click();
await page.getByLabel('Speaker name').fill('Aditi');
await page.getByRole('button', { name: 'Save speaker' }).click();
await expect(page.getByText('Aditi')).toBeVisible();
```

- [ ] **Step 2: Run the Playwright test and confirm it fails because the pages do not exist.**
- [ ] **Step 3: Implement owner-scoped list/detail routes, report components, speaker-name editing, search filters, and a destructive-action confirmation dialog.**
- [ ] **Step 4: Implement deletion so it removes database records and schedules deletion of all audio objects and Google Docs export metadata. Show a completed-deletion confirmation.**
- [ ] **Step 5: Run unit, integration, and Playwright tests; commit `feat: add private meeting dashboard`.**

### Task 8: Export an approved report to Google Docs

**Files:**
- Create: `apps/web/src/server/google/google-auth.ts`, `apps/web/src/server/google/docs-exporter.ts`, `apps/web/src/server/google/docs-exporter.test.ts`
- Create: `apps/web/src/app/api/google/connect/route.ts`, `apps/web/src/app/api/meetings/[id]/export/google-doc/route.ts`
- Modify: `apps/web/src/app/meetings/[id]/page.tsx`

**Interfaces:**
- Consumes: authenticated meeting owner, a ready `MeetingReport`, and stored Google OAuth refresh credentials encrypted at rest.
- Produces: `exportMeetingToGoogleDoc(ownerId, meetingId, destination: { mode: 'new' } | { mode: 'append'; documentId: string }): Promise<{ documentId: string; url: string }>`.
- Export content order: title/date, summary, decisions, action items, speaker report, full transcript.

- [ ] **Step 1: Write exporter tests using a fake Google Docs client.**

```ts
it('creates a new document with decisions before the transcript', async () => {
  const result = await exportMeetingToGoogleDoc('user-a', 'meeting-a', { mode: 'new' });
  expect(fakeDocs.batchUpdate).toHaveBeenCalledWith(expect.objectContaining({
    requests: expect.arrayContaining([expect.objectContaining({ insertText: expect.any(Object) })]),
  }));
  expect(result.url).toMatch(/^https:\/\/docs\.google\.com\/document\/d\//);
});
```

- [ ] **Step 2: Run the exporter test and confirm it fails.**
- [ ] **Step 3: Implement Google OAuth with the minimum Drive/Docs scopes, encrypted refresh-token storage, connect/disconnect routes, and a Docs exporter that supports new and append destinations.**
- [ ] **Step 4: Add an Export to Google Docs UI with destination choice, success link, token-expiry reauthorization message, and no silent sharing changes.**
- [ ] **Step 5: Run fake-client tests and a manual test against a dedicated development Google account; commit `feat: export reports to Google Docs`.**

### Task 9: Retention, error recovery, and release verification

**Files:**
- Create: `apps/worker/src/jobs/delete-expired-audio.ts`, `apps/worker/src/jobs/delete-expired-audio.test.ts`
- Create: `apps/web/src/app/meetings/[id]/error.tsx`, `apps/web/e2e/recording-lifecycle.spec.ts`
- Create: `README.md`, `docs/privacy-and-consent.md`, `docs/deployment.md`

**Interfaces:**
- Consumes: meetings whose `rawAudioDeleteAfter <= now` or whose owner deleted them.
- Produces: idempotent deletion of associated object-store chunks and redacted operational logs.
- Retryable statuses are `uploading`, `processing`, and `failed`; deleted meetings cannot be retried.

- [ ] **Step 1: Write tests proving cleanup deletes matching audio once, ignores already-missing objects, and never deletes audio for a meeting still being processed.**

```ts
it('deletes completed meeting audio after its retention time', async () => {
  await repository.setStatus(meeting.id, 'ready');
  await repository.setRawAudioDeleteAfter(meeting.id, new Date('2020-01-01'));
  await deleteExpiredAudio(new Date('2020-01-02'));
  expect(fakeStore.deletePrefix).toHaveBeenCalledWith(`meetings/${meeting.id}/`);
});
```

- [ ] **Step 2: Run cleanup tests and confirm they fail.**
- [ ] **Step 3: Implement the idempotent cleanup job, retry queues with bounded attempts, user-visible error/retry states, structured redacted logging, and alerts for repeated job failures.**
- [ ] **Step 4: Write deployment documentation listing required secrets: database, Redis, object storage, OpenAI, Google OAuth client, encryption key, and extension public API URL. Document the consent requirement and data-retention behaviour.**
- [ ] **Step 5: Run the full test suite, then manually test a 10-minute English call, a Hindi/Hinglish call, a Marathi-English call, an interrupted upload, speaker renaming, Google Docs export, and deletion. Commit `feat: harden meeting assistant MVP`.**

## Plan self-review

- **Spec coverage:** Tasks 3–5 cover Google Meet detection, explicit recording, audio capture, language choice, and transcription. Tasks 5–6 cover speaker-aware transcript, talk time, decisions, action items, and English summaries. Task 7 covers private history, search, edits, download-ready report display, and deletion. Task 8 covers new/append Google Docs export. Task 9 covers retention, recovery, and verification.
- **Intentional exclusions:** Live captions, message-platform delivery, recurring analytics, voice profiles, and non-Meet platforms remain later upgrades as specified.
- **Privacy check:** Capture is UI-gated; API keys never enter the extension; data queries are owner-scoped; deletion and retention are explicit tasks.
- **Consistency check:** The shared contracts define the status, language, input, report, and action-item shapes consumed by the extension, web application, and worker.
