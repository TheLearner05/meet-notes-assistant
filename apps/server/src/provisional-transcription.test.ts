import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MeetingStore } from './meeting-store.js';
import { ProvisionalTranscriptionQueue } from './provisional-transcription.js';

async function createStore(): Promise<{ store: MeetingStore; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'meet-notes-provisional-'));
  const store = new MeetingStore(root);
  await store.init();
  return { store, root };
}

describe('ProvisionalTranscriptionQueue', () => {
  it('stores chunk text in sequence order even when requests finish out of order', async () => {
    const { store, root } = await createStore();
    try {
      const meeting = await store.create('auto');
      const queue = new ProvisionalTranscriptionQueue(store, async (audioPath) => {
        if (audioPath.endsWith('first.webm')) await new Promise((resolve) => setTimeout(resolve, 15));
        return audioPath.endsWith('first.webm') ? 'first' : 'second';
      });

      await Promise.all([
        queue.enqueue(meeting.id, 1, join(root, 'second.webm'), 'auto'),
        queue.enqueue(meeting.id, 0, join(root, 'first.webm'), 'auto'),
      ]);
      await queue.flush(meeting.id);

      expect((await store.get(meeting.id))?.provisionalTranscript).toEqual([
        { speakerLabel: 'Speaker pending', startSeconds: 0, endSeconds: 30, text: 'first' },
        { speakerLabel: 'Speaker pending', startSeconds: 30, endSeconds: 60, text: 'second' },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('runs no more than two chunk transcriptions concurrently', async () => {
    const { store, root } = await createStore();
    try {
      const meeting = await store.create('auto');
      let inFlight = 0;
      let maximumInFlight = 0;
      const queue = new ProvisionalTranscriptionQueue(store, async () => {
        inFlight += 1;
        maximumInFlight = Math.max(maximumInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 10));
        inFlight -= 1;
        return 'text';
      });

      await Promise.all([0, 1, 2, 3].map((sequence) => queue.enqueue(meeting.id, sequence, join(root, `${sequence}.webm`), 'auto')));

      expect(maximumInFlight).toBeLessThanOrEqual(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
