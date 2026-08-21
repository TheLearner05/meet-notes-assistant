import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMeetingRecord, MeetingStore } from './meeting-store.js';

describe('createMeetingRecord', () => {
  it('creates a new Google Meet recording in the recording state', () => {
    const meeting = createMeetingRecord('mr-en', new Date('2026-08-19T10:00:00.000Z'));

    expect(meeting).toMatchObject({
      source: 'google-meet',
      language: 'mr-en',
      status: 'recording',
      rawAudioDeleteAfter: '2026-08-20T10:00:00.000Z',
    });
    expect(meeting.id).toMatch(/^[a-z0-9-]+$/);
  });
});

describe('fast processing state', () => {
  it('creates separate provisional and final state for a new meeting', () => {
    expect(createMeetingRecord('auto')).toMatchObject({
      processingStage: 'recording',
      processingProgress: { completed: 0, total: 0 },
      provisionalTranscript: [],
      finalTranscript: [],
    });
  });

  it('preserves concurrent updates to the same meeting', async () => {
    const root = await mkdtemp(join(tmpdir(), 'meet-notes-store-'));
    try {
      const store = new MeetingStore(root);
      await store.init();
      const meeting = await store.create('auto');
      await Promise.all([
        store.update(meeting.id, (item) => { item.processingStage = 'transcribing_fast'; }),
        store.update(meeting.id, (item) => { item.error = 'Transient upload error'; }),
      ]);

      expect(await store.get(meeting.id)).toMatchObject({
        processingStage: 'transcribing_fast',
        error: 'Transient upload error',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
