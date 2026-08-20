import { describe, expect, it } from 'vitest';
import { recordingStatusMessage, shouldAutoStopRecording, shouldShowRecordingPrompt } from './recording-prompt.js';

describe('shouldShowRecordingPrompt', () => {
  it('shows one prompt for an active call that is not already recording', () => {
    expect(shouldShowRecordingPrompt('in-call', false)).toBe(true);
  });

  it('does not prompt in the lobby or while recording', () => {
    expect(shouldShowRecordingPrompt('lobby', false)).toBe(false);
    expect(shouldShowRecordingPrompt('in-call', true)).toBe(false);
  });
});

describe('shouldAutoStopRecording', () => {
  it('stops an active recording after the call has ended or returned to the lobby', () => {
    expect(shouldAutoStopRecording('lobby', true)).toBe(true);
    expect(shouldAutoStopRecording('ended', true)).toBe(true);
  });

  it('does not stop a live call or an inactive recorder', () => {
    expect(shouldAutoStopRecording('in-call', true)).toBe(false);
    expect(shouldAutoStopRecording('lobby', false)).toBe(false);
  });
});

describe('recordingStatusMessage', () => {
  it('uses unmistakable messages for recording on and recording off', () => {
    expect(recordingStatusMessage('on')).toBe('● RECORDING ON');
    expect(recordingStatusMessage('off')).toBe('✓ RECORDING OFF — Saving meeting');
  });
});
