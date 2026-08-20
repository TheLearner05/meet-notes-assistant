import { describe, expect, it, vi } from 'vitest';
import { CaptureController, createOffscreenDocumentEnsurer } from './capture-controller.js';

describe('CaptureController', () => {
  it('refuses to capture audio without an explicit user click', async () => {
    const startTabAudio = vi.fn();
    const ensureOffscreenDocument = vi.fn();
    const controller = new CaptureController({ startTabAudio, ensureOffscreenDocument });

    await expect(controller.start({ tabId: 42, explicitUserClick: false })).rejects.toThrow(
      'Recording must be started by the user',
    );
    expect(startTabAudio).not.toHaveBeenCalled();
  });

  it('starts capture for an active Meet tab after an explicit user click', async () => {
    const startTabAudio = vi.fn().mockResolvedValue(undefined);
    const ensureOffscreenDocument = vi.fn().mockResolvedValue(undefined);
    const controller = new CaptureController({ startTabAudio, ensureOffscreenDocument });

    await controller.start({ tabId: 42, explicitUserClick: true });

    expect(startTabAudio).toHaveBeenCalledWith(42);
  });

  it('ensures the existing offscreen document is ready before capturing', async () => {
    const ensureOffscreenDocument = vi.fn().mockResolvedValue(undefined);
    const startTabAudio = vi.fn().mockResolvedValue(undefined);
    const controller = new CaptureController({ startTabAudio, ensureOffscreenDocument } as never);

    await controller.start({ tabId: 42, explicitUserClick: true });

    expect(ensureOffscreenDocument).toHaveBeenCalledTimes(1);
    expect(startTabAudio).toHaveBeenCalledWith(42);
  });
});

describe('createOffscreenDocumentEnsurer', () => {
  it('reuses an existing offscreen document instead of creating a second one', async () => {
    const hasOffscreenDocument = vi.fn().mockResolvedValue(true);
    const createOffscreenDocument = vi.fn().mockResolvedValue(undefined);
    const ensure = createOffscreenDocumentEnsurer({ hasOffscreenDocument, createOffscreenDocument });

    await ensure();

    expect(createOffscreenDocument).not.toHaveBeenCalled();
  });

  it('creates the document only once when two starts happen at the same time', async () => {
    const hasOffscreenDocument = vi.fn().mockResolvedValue(false);
    const createOffscreenDocument = vi.fn().mockResolvedValue(undefined);
    const ensure = createOffscreenDocumentEnsurer({ hasOffscreenDocument, createOffscreenDocument });

    await Promise.all([ensure(), ensure()]);

    expect(createOffscreenDocument).toHaveBeenCalledTimes(1);
  });
});
