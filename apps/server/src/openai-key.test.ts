import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyStoredOpenAiKey, loadOpenAiKey, saveOpenAiKey } from './openai-key.js';

describe('openai key storage', () => {
  const originalEnvKey = process.env.OPENAI_API_KEY;

  beforeEach(() => { delete process.env.OPENAI_API_KEY; });
  afterEach(() => {
    if (originalEnvKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalEnvKey;
  });

  it('has no saved key until one is saved', async () => {
    const root = await mkdtemp(join(tmpdir(), 'meet-notes-openai-key-'));
    try {
      expect(await loadOpenAiKey(root)).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('persists a saved key across loads', async () => {
    const root = await mkdtemp(join(tmpdir(), 'meet-notes-openai-key-'));
    try {
      await saveOpenAiKey(root, 'sk-test-123');
      expect(await loadOpenAiKey(root)).toBe('sk-test-123');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('trims surrounding whitespace before saving', async () => {
    const root = await mkdtemp(join(tmpdir(), 'meet-notes-openai-key-'));
    try {
      await saveOpenAiKey(root, '  sk-test-123  ');
      expect(await loadOpenAiKey(root)).toBe('sk-test-123');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a blank key', async () => {
    const root = await mkdtemp(join(tmpdir(), 'meet-notes-openai-key-'));
    try {
      await expect(saveOpenAiKey(root, '   ')).rejects.toThrow('API key is required');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('takes effect immediately without a restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'meet-notes-openai-key-'));
    try {
      await saveOpenAiKey(root, 'sk-test-123');
      expect(process.env.OPENAI_API_KEY).toBe('sk-test-123');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('seeds process.env from a previously saved key on startup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'meet-notes-openai-key-'));
    try {
      await saveOpenAiKey(root, 'sk-test-123');
      delete process.env.OPENAI_API_KEY;

      await applyStoredOpenAiKey(root);

      expect(process.env.OPENAI_API_KEY).toBe('sk-test-123');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('never overrides an explicitly set environment variable with a saved key', async () => {
    const root = await mkdtemp(join(tmpdir(), 'meet-notes-openai-key-'));
    try {
      await saveOpenAiKey(root, 'sk-saved-key');
      process.env.OPENAI_API_KEY = 'sk-real-env-key';

      await applyStoredOpenAiKey(root);

      expect(process.env.OPENAI_API_KEY).toBe('sk-real-env-key');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
