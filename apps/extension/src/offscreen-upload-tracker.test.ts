import { describe, expect, it } from 'vitest';
import { UploadTracker } from './offscreen-upload-tracker.js';

describe('UploadTracker', () => {
  it('waits for every in-flight audio upload before finishing a recording', async () => {
    let completeUpload!: () => void;
    const uploaded = new Promise<void>((resolve) => { completeUpload = resolve; });
    const tracker = new UploadTracker();
    tracker.track(uploaded);
    const order: string[] = [];
    const finish = tracker.drain().then(() => order.push('finish'));

    await Promise.resolve();
    expect(order).toEqual([]);
    completeUpload();
    await finish;
    expect(order).toEqual(['finish']);
  });
});
