import { describe, expect, it } from 'vitest';
import { isExportReady } from './microsoft-export.js';

describe('isExportReady', () => {
  it('is ready once the final speaker report finishes', () => {
    expect(isExportReady({ processingStage: 'final_ready' })).toBe(true);
  });

  it('is ready when final diarization has definitively failed but initial notes exist', () => {
    expect(isExportReady({ processingStage: 'initial_ready', finalError: 'FFmpeg is required to prepare the speaker report.' })).toBe(true);
  });

  it('is not ready while still recording, transcribing, or diarizing', () => {
    expect(isExportReady({ processingStage: 'recording' })).toBe(false);
    expect(isExportReady({ processingStage: 'transcribing_fast' })).toBe(false);
    expect(isExportReady({ processingStage: 'diarizing' })).toBe(false);
  });

  it('is not ready for initial notes alone while final diarization might still succeed', () => {
    expect(isExportReady({ processingStage: 'initial_ready' })).toBe(false);
  });

  it('is not ready for a meeting that failed outright', () => {
    expect(isExportReady({ processingStage: 'failed' })).toBe(false);
  });
});
