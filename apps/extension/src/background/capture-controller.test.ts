import { describe, expect, it, vi } from 'vitest';
import { CaptureController } from './capture-controller.js';

describe('CaptureController', () => {
  it('refuses to capture audio without an explicit user click', async () => {
    const startTabAudio = vi.fn();
    const controller = new CaptureController({ startTabAudio });

    await expect(controller.start({ tabId: 42, explicitUserClick: false })).rejects.toThrow(
      'Recording must be started by the user',
    );
    expect(startTabAudio).not.toHaveBeenCalled();
  });

  it('starts capture for an active Meet tab after an explicit user click', async () => {
    const startTabAudio = vi.fn().mockResolvedValue(undefined);
    const controller = new CaptureController({ startTabAudio });

    await controller.start({ tabId: 42, explicitUserClick: true });

    expect(startTabAudio).toHaveBeenCalledWith(42);
  });
});
