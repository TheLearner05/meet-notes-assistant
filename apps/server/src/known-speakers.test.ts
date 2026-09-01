import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KnownSpeakerStore } from './known-speakers.js';

describe('KnownSpeakerStore', () => {
  it('starts empty when no names have been remembered yet', async () => {
    const root = await mkdtemp(join(tmpdir(), 'meet-notes-known-speakers-'));
    try {
      const store = new KnownSpeakerStore(root);
      await store.init();
      expect(await store.list()).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('remembers a renamed speaker for future autocomplete', async () => {
    const root = await mkdtemp(join(tmpdir(), 'meet-notes-known-speakers-'));
    try {
      const store = new KnownSpeakerStore(root);
      await store.init();
      await store.remember('Priya');
      expect(await store.list()).toEqual(['Priya']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('deduplicates names regardless of casing or surrounding whitespace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'meet-notes-known-speakers-'));
    try {
      const store = new KnownSpeakerStore(root);
      await store.init();
      await store.remember('Priya');
      await store.remember('  priya  ');
      await store.remember('Rahul');
      expect(await store.list()).toEqual(['Priya', 'Rahul']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('ignores blank names', async () => {
    const root = await mkdtemp(join(tmpdir(), 'meet-notes-known-speakers-'));
    try {
      const store = new KnownSpeakerStore(root);
      await store.init();
      await store.remember('   ');
      expect(await store.list()).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('persists remembered names across store instances', async () => {
    const root = await mkdtemp(join(tmpdir(), 'meet-notes-known-speakers-'));
    try {
      const first = new KnownSpeakerStore(root);
      await first.init();
      await first.remember('Priya');

      const second = new KnownSpeakerStore(root);
      await second.init();
      expect(await second.list()).toEqual(['Priya']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
