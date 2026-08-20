import { describe, expect, it } from 'vitest';
import { RecordingSession, type RecordingSessionStorage } from './recording-session.js';

function memoryStorage(): RecordingSessionStorage {
  const values = new Map<string, unknown>();
  return {
    async get(key) { return { [key]: values.get(key) }; },
    async set(value) { Object.entries(value).forEach(([key, item]) => values.set(key, item)); },
    async remove(key) { values.delete(key); },
  };
}

describe('RecordingSession', () => {
  it('keeps the active recording tab after a background-worker restart', async () => {
    const storage = memoryStorage();
    const firstWorker = new RecordingSession(storage);
    await firstWorker.start(42);

    const restartedWorker = new RecordingSession(storage);
    expect(await restartedWorker.activeTabId()).toBe(42);
  });

  it('only clears the matching recording tab', async () => {
    const session = new RecordingSession(memoryStorage());
    await session.start(42);

    expect(await session.stop(99)).toBe(false);
    expect(await session.activeTabId()).toBe(42);
    expect(await session.stop(42)).toBe(true);
    expect(await session.activeTabId()).toBeUndefined();
  });
});
