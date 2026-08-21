import { describe, expect, it } from 'vitest';
import { retryTransient } from './processing-retry.js';

describe('retryTransient', () => {
  it('retries a timed-out request and returns its later result', async () => {
    let calls = 0;

    await expect(retryTransient(async () => {
      calls += 1;
      if (calls === 1) throw new Error('Request timed out.');
      return 'ready';
    }, { delay: async () => undefined })).resolves.toBe('ready');

    expect(calls).toBe(2);
  });

  it('does not retry a permanent bad-request error', async () => {
    let calls = 0;

    await expect(retryTransient(async () => {
      calls += 1;
      throw new Error('400 Unsupported format');
    }, { delay: async () => undefined })).rejects.toThrow('400 Unsupported format');

    expect(calls).toBe(1);
  });
});
