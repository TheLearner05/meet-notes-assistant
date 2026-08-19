import { describe, expect, it } from 'vitest';
import { shouldShowRecordingPrompt } from './recording-prompt.js';

describe('shouldShowRecordingPrompt', () => {
  it('shows one prompt for an active call that is not already recording', () => {
    expect(shouldShowRecordingPrompt('in-call', false)).toBe(true);
  });

  it('does not prompt in the lobby or while recording', () => {
    expect(shouldShowRecordingPrompt('lobby', false)).toBe(false);
    expect(shouldShowRecordingPrompt('in-call', true)).toBe(false);
  });
});
