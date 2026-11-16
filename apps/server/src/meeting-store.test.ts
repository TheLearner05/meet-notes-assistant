import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMeetingRecord, isStaleRecording, MeetingStore } from './meeting-store.js';

let writeFileOverride: ((path: unknown, data: unknown) => Promise<void>) | undefined;

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: (path: unknown, data: unknown, ...rest: unknown[]) =>
      writeFileOverride ? writeFileOverride(path, data) : (actual.writeFile as (...a: unknown[]) => Promise<void>)(path, data, ...rest),
  };
});

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

  it('preserves an optional meeting title when provided', () => {
    const meeting = createMeetingRecord('en', new Date('2026-08-19T10:00:00.000Z'), 'Sprint Retrospective');
    expect(meeting.title).toBe('Sprint Retrospective');
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

  it('searches meetings by title and user scratchpad notes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'meet-notes-store-'));
    try {
      const store = new MeetingStore(root);
      await store.init();
      const m1 = await store.create('en', 'Q4 Budget Review');
      await store.update(m1.id, (item) => { item.userNotes = 'Approved 50k marketing spend'; });
      await store.create('mr-en', 'Frontend Standup');

      const byTitle = await store.list('budget');
      expect(byTitle).toHaveLength(1);
      expect(byTitle[0].id).toBe(m1.id);

      const byNotes = await store.list('marketing spend');
      expect(byNotes).toHaveLength(1);
      expect(byNotes[0].id).toBe(m1.id);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('bumps updatedAt whenever a meeting changes, such as a chunk upload', async () => {
    const root = await mkdtemp(join(tmpdir(), 'meet-notes-store-'));
    try {
      const store = new MeetingStore(root);
      await store.init();
      const meeting = await store.create('auto');
      const createdUpdatedAt = meeting.updatedAt;
      await new Promise((resolve) => setTimeout(resolve, 5));
      await store.saveChunk(meeting.id, '0', Buffer.from('audio'));

      const saved = await store.get(meeting.id);
      expect(saved?.updatedAt).not.toBe(createdUpdatedAt);
      expect(new Date(saved!.updatedAt).getTime()).toBeGreaterThan(new Date(createdUpdatedAt).getTime());
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('never lets a concurrent get() observe a torn write to meetings.json', async () => {
    const root = await mkdtemp(join(tmpdir(), 'meet-notes-store-'));
    try {
      const store = new MeetingStore(root);
      await store.init();
      const meeting = await store.create('auto');

      // fs.writeFile is not atomic: it truncates the file before writing the new
      // content. Simulate that window by truncating immediately and delaying the
      // real write, matching what happens when a save is interrupted mid-flight.
      const { writeFile: realWriteFile } = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      writeFileOverride = async (path, data) => {
        await realWriteFile(path as never, '');
        await new Promise((resolve) => setTimeout(resolve, 20));
        await realWriteFile(path as never, data as never);
      };

      try {
        const [, readResult] = await Promise.all([
          store.update(meeting.id, (item) => { item.error = 'boom'; }),
          (async () => {
            await new Promise((resolve) => setTimeout(resolve, 5));
            return store.get(meeting.id);
          })(),
        ]);

        expect(readResult).toBeDefined();
      } finally {
        writeFileOverride = undefined;
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('isStaleRecording', () => {
  const now = new Date('2026-08-20T18:00:00.000Z');

  it('is not stale while still recording', () => {
    const meeting = { status: 'recording', createdAt: '2026-08-20T17:00:00.000Z', updatedAt: '2026-08-20T17:00:00.000Z' } as const;
    expect(isStaleRecording(meeting, now)).toBe(false);
  });

  it('is stale once a recording has had no activity past the threshold', () => {
    const meeting = { status: 'recording', createdAt: '2026-08-20T14:00:00.000Z', updatedAt: '2026-08-20T14:00:00.000Z' } as const;
    expect(isStaleRecording(meeting, now)).toBe(true);
  });

  it('ignores meetings that are not still recording', () => {
    const meeting = { status: 'processing', createdAt: '2026-08-20T10:00:00.000Z', updatedAt: '2026-08-20T10:00:00.000Z' } as const;
    expect(isStaleRecording(meeting, now)).toBe(false);
  });

  it('falls back to createdAt for records saved before updatedAt existed', () => {
    const meeting = { status: 'recording', createdAt: '2026-08-20T10:00:00.000Z', updatedAt: undefined } as const;
    expect(isStaleRecording(meeting, now)).toBe(true);
  });
});
