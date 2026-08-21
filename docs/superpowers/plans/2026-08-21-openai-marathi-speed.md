# OpenAI Marathi Quality and Long-Meeting Speed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve Marathi/Hindi/English transcripts with OpenAI's current transcription model and make long meetings complete safely with visible progress.

**Architecture:** The server maps the meeting language choice to explicit OpenAI hints and uses `gpt-transcribe` for ordinary transcript sections. It retains `gpt-4o-transcribe-diarize` for speaker attribution, but processes shorter sections concurrently with retry handling and persists per-phase progress for the dashboard.

**Tech Stack:** TypeScript, Node.js, OpenAI Node SDK, FFmpeg, Vitest, static HTML dashboard.

**Spec:** `docs/superpowers/specs/2026-08-21-marathi-quality-google-docs-design.md`

## Global Constraints

- Keep all audio capture and API keys local; the Chrome extension must never receive the OpenAI API key.
- Use `gpt-transcribe` for ordinary recorded-speech transcription and `gpt-4o-transcribe-diarize` only for final speaker labels.
- Marathi uses `mr`, Hindi uses `hi`, English uses `en`, and Auto supplies all three expected languages.
- Do not add a new AI provider in this plan.
- Do not claim a fixed two-minute completion time; show actual stage progress instead.

---

## File structure

- `apps/server/src/transcription-config.ts`: OpenAI language and vocabulary mapping.
- `apps/server/src/processing-retry.ts`: transient request retry policy.
- `apps/server/src/meeting-store.ts`: persisted processing progress.
- `apps/server/src/reporting.ts`: model calls, safe segmentation, progress, retries, and ordered diarization.
- `apps/server/src/server.ts`: initial request construction shared with the selected model.
- `apps/server/public/index.html`: section-completion feedback.
- Corresponding `*.test.ts` files: unit and integration-like coverage.

### Task 1: Configure `gpt-transcribe` for Indian-language meetings

**Files:**
- Create: `apps/server/src/transcription-config.ts`
- Create: `apps/server/src/transcription-config.test.ts`
- Modify: `apps/server/src/reporting.ts`
- Modify: `apps/server/src/server.ts`

**Interfaces:**
- Produces: `openAiLanguageHints(language: MeetingLanguage): string[]`
- Produces: `openAiVocabulary(value?: string): string[]`
- Consumed by: all ordinary `gpt-transcribe` requests.

- [ ] **Step 1: Write the failing test**

```ts
expect(openAiLanguageHints('auto')).toEqual(['mr', 'hi', 'en']);
expect(openAiLanguageHints('mr-en')).toEqual(['mr', 'en']);
expect(openAiVocabulary('NitroCool, Sumit, NitroCool, ')).toEqual(['NitroCool', 'Sumit']);
```

- [ ] **Step 2: Verify the test fails**

Run: `pnpm --filter @meet-notes/server test -- transcription-config.test.ts`

Expected: FAIL because the new module is absent.

- [ ] **Step 3: Implement the mapping and model request**

```ts
export function openAiLanguageHints(language: MeetingLanguage): string[] {
  if (language === 'mr-en') return ['mr', 'en'];
  if (language === 'hi-en') return ['hi', 'en'];
  if (language === 'en') return ['en'];
  return ['mr', 'hi', 'en'];
}

export function openAiVocabulary(value = process.env.OPENAI_TRANSCRIPTION_VOCABULARY ?? ''): string[] {
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))].slice(0, 100);
}
```

Use `model: 'gpt-transcribe'`, `languages: openAiLanguageHints(language)`, and `keywords: openAiVocabulary()` in both initial-transcription request paths. Preserve the current type cast only for SDK fields unavailable in its typings.

- [ ] **Step 4: Verify and commit**

Run: `pnpm --filter @meet-notes/server test && pnpm --filter @meet-notes/server typecheck`

Expected: PASS.

```bash
git add apps/server/src/transcription-config.ts apps/server/src/transcription-config.test.ts apps/server/src/reporting.ts apps/server/src/server.ts
git commit -m "feat: guide OpenAI transcription for Indian languages"
```

### Task 2: Persist progress and retry transient OpenAI errors

**Files:**
- Create: `apps/server/src/processing-retry.ts`
- Create: `apps/server/src/processing-retry.test.ts`
- Modify: `apps/server/src/meeting-store.ts`
- Modify: `apps/server/src/meeting-store.test.ts`

**Interfaces:**
- Produces: `retryTransient<T>(operation: () => Promise<T>, options?: RetryOptions): Promise<T>`
- Produces: `MeetingProcessingProgress = { completed: number; total: number; retrying?: number }`

- [ ] **Step 1: Write failing retry and store tests**

```ts
let calls = 0;
await expect(retryTransient(async () => {
  calls += 1;
  if (calls === 1) throw new Error('Request timed out.');
  return 'ready';
}, { delay: async () => undefined })).resolves.toBe('ready');
expect(calls).toBe(2);

await expect(retryTransient(async () => { throw new Error('400 Unsupported format'); }, { delay: async () => undefined }))
  .rejects.toThrow('400 Unsupported format');
expect((await store.get(meeting.id))?.processingProgress).toEqual({ completed: 0, total: 0 });
```

- [ ] **Step 2: Verify the tests fail**

Run: `pnpm --filter @meet-notes/server test -- processing-retry.test.ts meeting-store.test.ts`

Expected: FAIL because retry and progress state are absent.

- [ ] **Step 3: Implement retry and state**

```ts
export async function retryTransient<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 3;
  for (let attempt = 1; ; attempt += 1) {
    try { return await operation(); }
    catch (error) {
      if (attempt >= attempts || !isTransient(error)) throw error;
      await (options.delay ?? defaultDelay)(attempt);
    }
  }
}
```

Classify timeouts, connection resets, `429`, and `5xx` responses as transient. Add and hydrate `processingProgress: { completed: 0, total: 0 }`; never store credentials or error text in it.

- [ ] **Step 4: Verify and commit**

Run: `pnpm --filter @meet-notes/server test && pnpm --filter @meet-notes/server typecheck`

Expected: PASS.

```bash
git add apps/server/src/processing-retry.ts apps/server/src/processing-retry.test.ts apps/server/src/meeting-store.ts apps/server/src/meeting-store.test.ts
git commit -m "feat: track processing progress and retry transient failures"
```

### Task 3: Speed up and recover final speaker analysis

**Files:**
- Modify: `apps/server/src/reporting.ts`
- Modify: `apps/server/src/reporting.test.ts`

**Interfaces:**
- Consumes: `retryTransient`, `MeetingProcessingProgress`, `MeetingAi.diarize()`.
- Produces: time-ordered `finalTranscript` from 600-second sections with bounded parallelism.

- [ ] **Step 1: Write failing reporting tests**

```ts
const diarize = vi.fn(async (audioPath: string) => {
  if (audioPath.endsWith('000.webm')) await new Promise((done) => setTimeout(done, 20));
  return { segments: [{ speaker: 'A', start: 0, end: 3, text: audioPath.endsWith('000.webm') ? 'first' : 'second' }] };
});
await processFinalDiarizedMeeting(store, meeting.id, root, { diarize, summarize: async () => '{}' }, twoSegmentAudio);
expect((await store.get(meeting.id))?.finalTranscript.map((item) => item.text)).toEqual(['first', 'second']);
expect((await store.get(meeting.id))?.processingProgress).toEqual({ completed: 2, total: 2 });
```

- [ ] **Step 2: Verify the test fails**

Run: `pnpm --filter @meet-notes/server test -- reporting.test.ts`

Expected: FAIL because final diarization is sequential and does not persist progress.

- [ ] **Step 3: Implement bounded section work**

Set final diarization sections to 600 seconds. Before calls start, persist `{ completed: 0, total: segments.length }`. Call `mapWithConcurrency(segments, 2, ...)`, wrap each diarization call in `retryTransient`, and increment `completed` after each resolved section. Preserve the segment-array order before flattening to retain actual transcript time order. Keep the existing batch prefix for speakers, avoiding false speaker identity merges between independent sections.

- [ ] **Step 4: Verify and commit**

Run: `pnpm test && pnpm typecheck`

Expected: PASS.

```bash
git add apps/server/src/reporting.ts apps/server/src/reporting.test.ts
git commit -m "feat: speed and retry long meeting speaker analysis"
```

### Task 4: Display actual processing progress

**Files:**
- Modify: `apps/server/public/index.html`
- Modify: `apps/server/src/reporting.test.ts`

**Interfaces:**
- Consumes: `processingStage` and `processingProgress` from the meeting API.
- Produces: `Creating initial notes — 2 of 14 sections complete` and `Creating speaker report — 5 of 14 sections complete`.

- [ ] **Step 1: Add the progress assertion**

```ts
expect((await store.get(meeting.id))?.processingProgress.total).toBe(2);
```

- [ ] **Step 2: Verify the test fails before Task 3 is implemented**

Run: `pnpm --filter @meet-notes/server test -- reporting.test.ts`

Expected: FAIL because final processing does not record a total section count.

- [ ] **Step 3: Render completed and total sections**

```js
const progressText = m => {
  const p = m.processingProgress;
  if (!p?.total) return stageMessage(m);
  const label = m.processingStage === 'diarizing' ? 'Creating speaker report' : 'Creating initial notes';
  return `${label} — ${p.completed} of ${p.total} sections complete${p.retrying ? ' (retrying a section)' : ''}`;
};
```

Use `progressText` in the list and selected-meeting badge. Preserve the existing retry control and the clear distinction between initial notes and final speaker labels.

- [ ] **Step 4: Verify and commit**

Run: `pnpm test && pnpm typecheck`

Expected: PASS. Manually start the local server and check that a meeting with progress shows its section count at `http://localhost:8787`.

```bash
git add apps/server/public/index.html apps/server/src/reporting.test.ts
git commit -m "feat: show meeting processing progress"
```

## Plan self-review

- Tasks 1–4 cover the OpenAI model change, language guidance, vocabulary, short valid sections, bounded parallelism, retries, progress, privacy boundary, and tests.
- Google OAuth setup remains a separate follow-up because it is independent from the requested OpenAI optimisation.
- The plan defines every cross-task type and contains no unresolved placeholders.
