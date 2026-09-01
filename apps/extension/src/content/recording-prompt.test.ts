import { describe, expect, it } from 'vitest';
import { recordingStatusMessage, shouldAutoStopForLoneParticipant, shouldAutoStopRecording, shouldShowRecordingPrompt } from './recording-prompt.js';

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

describe('shouldAutoStopForLoneParticipant', () => {
  it('stops once the user has been alone in an active recording for at least the grace period', () => {
    expect(shouldAutoStopForLoneParticipant(true, 1, 30000, 30000)).toBe(true);
    expect(shouldAutoStopForLoneParticipant(true, 1, 45000, 30000)).toBe(true);
  });

  it('does not stop before the grace period elapses', () => {
    expect(shouldAutoStopForLoneParticipant(true, 1, 10000, 30000)).toBe(false);
  });

  it('does not stop when other participants are present', () => {
    expect(shouldAutoStopForLoneParticipant(true, 2, 60000, 30000)).toBe(false);
  });

  it('does not stop when the participant count is unknown', () => {
    expect(shouldAutoStopForLoneParticipant(true, undefined, 60000, 30000)).toBe(false);
  });

  it('does not stop when not recording', () => {
    expect(shouldAutoStopForLoneParticipant(false, 1, 60000, 30000)).toBe(false);
  });
});

describe('recordingStatusMessage', () => {
  it('uses unmistakable messages for recording on and recording off', () => {
    expect(recordingStatusMessage('on')).toBe('● RECORDING ON');
    expect(recordingStatusMessage('off')).toBe('✓ RECORDING OFF — Saving meeting');
  });

  it('uses an unmistakable message for a paused recording', () => {
    expect(recordingStatusMessage('paused')).toBe('❚❚ RECORDING PAUSED');
  });
});
