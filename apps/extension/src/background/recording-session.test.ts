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

  it('starts a new recording unpaused', async () => {
    const session = new RecordingSession(memoryStorage());
    await session.start(42);
    expect(await session.isPaused()).toBe(false);
  });

  it('tracks pause and resume for the active recording tab', async () => {
    const session = new RecordingSession(memoryStorage());
    await session.start(42);

    expect(await session.pause(42)).toBe(true);
    expect(await session.isPaused()).toBe(true);
    expect(await session.resume(42)).toBe(true);
    expect(await session.isPaused()).toBe(false);
  });

  it('ignores pause/resume for a tab that is not the active recording', async () => {
    const session = new RecordingSession(memoryStorage());
    await session.start(42);

    expect(await session.pause(99)).toBe(false);
    expect(await session.isPaused()).toBe(false);
  });

  it('survives a background-worker restart while paused', async () => {
    const storage = memoryStorage();
    const firstWorker = new RecordingSession(storage);
    await firstWorker.start(42);
    await firstWorker.pause(42);

    const restartedWorker = new RecordingSession(storage);
    expect(await restartedWorker.isPaused()).toBe(true);
  });

  it('clears the paused flag when the recording stops', async () => {
    const storage = memoryStorage();
    const session = new RecordingSession(storage);
    await session.start(42);
    await session.pause(42);

    await session.stop(42);

    expect(await new RecordingSession(storage).isPaused()).toBe(false);
  });
});
