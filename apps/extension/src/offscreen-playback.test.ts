import { describe, expect, it, vi } from 'vitest';
import { preserveLocalPlayback } from './offscreen-playback.js';

describe('preserveLocalPlayback', () => {
  it('routes the captured Meet audio stream to the default output', () => {
    const connect = vi.fn();
    const context = { destination: { id: 'default-output' }, createMediaStreamSource: vi.fn(() => ({ connect })), resume: vi.fn().mockResolvedValue(undefined) };
    const stream = {} as MediaStream;

    preserveLocalPlayback(stream, () => context as unknown as AudioContext);

    expect(context.createMediaStreamSource).toHaveBeenCalledWith(stream);
    expect(connect).toHaveBeenCalledWith(context.destination);
  });
});
