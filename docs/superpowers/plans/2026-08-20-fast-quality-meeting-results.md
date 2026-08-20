# Fast Quality Meeting Results Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a high-quality provisional transcript and summary shortly after a meeting stops, then replace it with the complete diarized speaker report when that slower job finishes.

**Architecture:** The server will enqueue each already-uploaded 30-second WebM chunk for `gpt-4o-transcribe` while recording continues. At stop, it will wait for that bounded queue and generate a provisional report from the ordered chunk text; the existing complete-file `gpt-4o-transcribe-diarize` job will run afterward and replace the provisional result with authoritative speaker labels and talk statistics.

**Tech Stack:** TypeScript, Node.js HTTP server, Chrome MV3 offscreen recorder, OpenAI Node SDK, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-20-fast-quality-meeting-results-design.md`

## Global Constraints

- Keep `OPENAI_API_KEY` on the local Node server; do not expose it to the extension.
- Use `gpt-4o-transcribe` for provisional chunk text and `gpt-4o-transcribe-diarize` for the final speaker report.
- Preserve Hindi, Marathi, English, and auto language behavior.
- Publish initial notes as provisional; never label them as a final speaker report.
- Use at most two concurrent provisional transcription requests.
- The final diarization failure must not delete a ready provisional result.

---

### Task 1: Make meeting processing state explicit and race-safe

**Status: complete** (commit `23f3daf`)

**Files:**
- Modify: `apps/server/src/meeting-store.ts`
- Modify: `apps/server/src/meeting-store.test.ts`

**Interfaces:**
- Produces `MeetingProcessingStage = 'recording' | 'transcribing_fast' | 'initial_ready' | 'diarizing' | 'final_ready' | 'failed'`.
- Produces `MeetingRecord.provisionalTranscript`, `MeetingRecord.provisionalReport`, `MeetingRecord.finalTranscript`, `MeetingRecord.finalReport`, and `MeetingRecord.processingStage`.
- Produces serialized `MeetingStore.update()` and `MeetingStore.saveChunk()` writes so parallel HTTP requests cannot lose chunks or transcript results.

- [ ] **Step 1: Write the failing store tests**

```ts
it('preserves updates made by concurrent writers', async () => {
  const store = await createTestStore();
  const meeting = await store.create('auto');
  await Promise.all([
    store.update(meeting.id, (item) => { item.processingStage = 'transcribing_fast'; }),
    store.update(meeting.id, (item) => { item.error = 'transient'; }),
  ]);
  expect(await store.get(meeting.id)).toMatchObject({ processingStage: 'transcribing_fast', error: 'transient' });
});

it('creates a meeting with distinct provisional and final processing state', () => {
  expect(createMeetingRecord('auto')).toMatchObject({ processingStage: 'recording', provisionalTranscript: [], finalTranscript: [] });
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `pnpm --filter @meet-notes/server test -- meeting-store.test.ts`

Expected: FAIL because the new processing properties and serialized writer behavior do not exist.

- [ ] **Step 3: Add state fields and a write mutex**

```ts
export type MeetingProcessingStage = 'recording' | 'transcribing_fast' | 'initial_ready' | 'diarizing' | 'final_ready' | 'failed';

export type MeetingRecord = {
  // existing fields
  processingStage: MeetingProcessingStage;
  provisionalTranscript: TranscriptSegment[];
  finalTranscript: TranscriptSegment[];
  provisionalReport?: MeetingReport;
  finalReport?: MeetingReport;
};

private writeChain: Promise<void> = Promise.resolve();
private async mutate<T>(operation: () => Promise<T>): Promise<T> {
  const previous = this.writeChain;
  let release!: () => void;
  this.writeChain = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try { return await operation(); } finally { release(); }
}
```

Wrap `update()` and `saveChunk()` mutations in `mutate()`. Initialise all new arrays and the `recording` stage in `createMeetingRecord()`.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `pnpm --filter @meet-notes/server test -- meeting-store.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/meeting-store.ts apps/server/src/meeting-store.test.ts
git commit -m "feat: track provisional and final meeting processing"
```

### Task 2: Transcribe uploaded chunks while a meeting is recording

**Status: complete** (commit `07d4e66`)

**Files:**
- Create: `apps/server/src/provisional-transcription.ts`
- Create: `apps/server/src/provisional-transcription.test.ts`
- Modify: `apps/server/src/server.ts`

**Interfaces:**
- Produces `ProvisionalTranscriptionQueue.enqueue(meetingId: string, sequence: number, audioPath: string, language: MeetingLanguage): Promise<void>`.
- Produces `ProvisionalTranscriptionQueue.flush(meetingId: string): Promise<void>`.
- Consumes `MeetingStore` and an injected `transcribe(file, language): Promise<string>` function.
- Stores ordered provisional segments with `speakerLabel: 'Speaker pending'`, `startSeconds: sequence * 30`, and the returned text.

- [ ] **Step 1: Write failing queue tests**

```ts
it('stores chunk text in sequence order even when requests finish out of order', async () => {
  const queue = new ProvisionalTranscriptionQueue(store, delayedTranscribe);
  await Promise.all([queue.enqueue(id, 1, secondFile, 'auto'), queue.enqueue(id, 0, firstFile, 'auto')]);
  await queue.flush(id);
  expect((await store.get(id))?.provisionalTranscript.map((item) => item.text)).toEqual(['first', 'second']);
});

it('never runs more than two provisional requests concurrently', async () => {
  const queue = new ProvisionalTranscriptionQueue(store, countedTranscribe);
  await Promise.all([0, 1, 2, 3].map((sequence) => queue.enqueue(id, sequence, file, 'auto')));
  await queue.flush(id);
  expect(maximumInFlight).toBeLessThanOrEqual(2);
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `pnpm --filter @meet-notes/server test -- provisional-transcription.test.ts`

Expected: FAIL because the queue does not exist.

- [ ] **Step 3: Implement the bounded queue and server hook**

```ts
export class ProvisionalTranscriptionQueue {
  constructor(private store: MeetingStore, private transcribe: ChunkTranscriber, private concurrency = 2) {}
  enqueue(meetingId: string, sequence: number, audioPath: string, language: MeetingLanguage): Promise<void> { /* queue one job */ }
  flush(meetingId: string): Promise<void> { /* resolve after that meeting has no queued or active jobs */ }
}
```

Use `openai.audio.transcriptions.create({ file: createReadStream(audioPath), model: 'gpt-4o-transcribe' })`, preserving the explicit English language hint only when `language === 'en'`. In the `PUT /chunks/:sequence` route, save the chunk first, then enqueue it without delaying the `200` response. Record a non-fatal per-chunk failure in the meeting record and let final diarization remain available.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `pnpm --filter @meet-notes/server test -- provisional-transcription.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/provisional-transcription.ts apps/server/src/provisional-transcription.test.ts apps/server/src/server.ts
git commit -m "feat: transcribe meeting chunks while recording"
```

### Task 3: Publish provisional notes, then replace them with diarized results

**Status: complete**

**Files:**
- Modify: `apps/server/src/reporting.ts`
- Modify: `apps/server/src/reporting.test.ts`
- Modify: `apps/server/src/server.ts`
- Modify: `apps/server/public/index.html`

**Interfaces:**
- Produces `processProvisionalMeeting(store, queue, meetingId): Promise<void>`.
- Produces `processFinalDiarizedMeeting(store, meetingId, dataRoot): Promise<void>`.
- `processProvisionalMeeting()` waits for `queue.flush(meetingId)`, creates `provisionalReport`, and sets `processingStage: 'initial_ready'`.
- `processFinalDiarizedMeeting()` creates `finalTranscript` and `finalReport`, then sets `processingStage: 'final_ready'` without deleting provisional values on failure.

- [ ] **Step 1: Write failing reporting tests**

```ts
it('publishes a provisional report before diarization completes', async () => {
  await processProvisionalMeeting(store, queue, meeting.id);
  expect(await store.get(meeting.id)).toMatchObject({ processingStage: 'initial_ready', provisionalReport: expect.any(Object) });
});

it('keeps provisional notes when final diarization fails', async () => {
  await processFinalDiarizedMeeting(store, meeting.id, root);
  expect((await store.get(meeting.id)?.provisionalReport).summary).toContain('Initial');
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `pnpm --filter @meet-notes/server test -- reporting.test.ts`

Expected: FAIL because initial and final processing functions do not exist.

- [ ] **Step 3: Split reporting into provisional and final jobs**

Build the provisional transcript from `provisionalTranscript`, call the existing JSON-report parser with the transcript text, and store the result in `provisionalReport`. Move the current full-file diarization body into `processFinalDiarizedMeeting()`, writing `finalTranscript` and `finalReport` only after success. Update the finish route to launch provisional processing first and final diarization after it, leaving a ready provisional result visible while final diarization continues.

- [ ] **Step 4: Update dashboard and exported report selection**

Render `finalReport` and `finalTranscript` when `processingStage === 'final_ready'`. Otherwise render `provisionalReport` and `provisionalTranscript` with an explicit `Speaker report still processing` banner. Make download and Google Docs export use the best currently available report and label provisional exports as `Initial notes — speaker attribution pending`.

- [ ] **Step 5: Run focused and full tests**

Run: `pnpm --filter @meet-notes/server test -- reporting.test.ts`

Expected: PASS.

Run: `pnpm test && pnpm typecheck`

Expected: all workspace tests and type checks PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/reporting.ts apps/server/src/reporting.test.ts apps/server/src/server.ts apps/server/public/index.html
git commit -m "feat: publish fast notes before speaker report"
```

### Task 4: Wait for final chunk upload before marking a meeting finished

**Status: complete**

**Files:**
- Modify: `apps/extension/src/offscreen.ts`
- Modify: `apps/extension/src/offscreen-playback.test.ts`

**Interfaces:**
- Produces an upload tracker that awaits all in-flight chunk PUT requests before `POST /finish`.
- Consumes the existing `upload(blob)` result and keeps failed uploads in the existing retry list.

- [ ] **Step 1: Write the failing upload-drain test**

```ts
it('waits for the final chunk upload before finishing the meeting', async () => {
  const order: string[] = [];
  await stopRecorder({ upload: async () => { order.push('upload'); }, finish: async () => { order.push('finish'); } });
  expect(order).toEqual(['upload', 'finish']);
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `pnpm --filter @meet-notes/extension test -- offscreen-playback.test.ts`

Expected: FAIL because recorder upload promises are not tracked before finish.

- [ ] **Step 3: Track active uploads in the recorder**

Maintain `const uploads = new Set<Promise<void>>()`. Add each `dataavailable` upload promise to the set, remove it in `finally`, and in `stop()` call `await Promise.all([...uploads])` after retrying `pending` blobs and before the `/finish` request.

- [ ] **Step 4: Run the focused and full extension checks**

Run: `pnpm --filter @meet-notes/extension test && pnpm --filter @meet-notes/extension typecheck`

Expected: all extension tests and type checks PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/offscreen.ts apps/extension/src/offscreen-playback.test.ts
git commit -m "fix: finish only after audio chunk uploads drain"
```

## Plan self-review

- Spec coverage: Task 1 defines separate provisional/final state; Task 2 performs quality-first incremental transcription; Task 3 publishes the two-stage dashboard/export result and preserves fallback behavior; Task 4 prevents the final audio from being omitted.
- Placeholder scan: no deferred implementation markers or unspecified tests remain.
- Type consistency: `provisionalTranscript`, `finalTranscript`, `provisionalReport`, `finalReport`, and `processingStage` are introduced in Task 1 and consumed consistently in Tasks 2 and 3.
