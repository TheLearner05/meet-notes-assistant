import { describe, expect, it } from 'vitest';
import { isCapturableMeetTab, shouldReleaseRecordingForNewStart, shouldStopRecordingForNavigation } from './tab-validation.js';

describe('isCapturableMeetTab', () => {
  it('allows an active Google Meet URL', () => {
    expect(isCapturableMeetTab('https://meet.google.com/abc-defg-hij')).toBe(true);
  });

  it('rejects non-Meet and browser pages', () => {
    expect(isCapturableMeetTab('https://example.com')).toBe(false);
    expect(isCapturableMeetTab('chrome://extensions')).toBe(false);
  });
});

describe('shouldStopRecordingForNavigation', () => {
  it('stops only the recording tab when it navigates away from Google Meet', () => {
    expect(shouldStopRecordingForNavigation(12, 12, 'https://example.com')).toBe(true);
    expect(shouldStopRecordingForNavigation(12, 13, 'https://example.com')).toBe(false);
  });

  it('keeps recording when the same tab stays on Google Meet', () => {
    expect(shouldStopRecordingForNavigation(12, 12, 'https://meet.google.com/abc-defg-hij')).toBe(false);
  });
});

describe('shouldReleaseRecordingForNewStart', () => {
  it('releases a stale session when its tab is gone or no longer in a call', () => {
    expect(shouldReleaseRecordingForNewStart(undefined)).toBe(true);
    expect(shouldReleaseRecordingForNewStart('lobby')).toBe(true);
    expect(shouldReleaseRecordingForNewStart('ended')).toBe(true);
  });

  it('keeps a genuinely live recording protected from a second start', () => {
    expect(shouldReleaseRecordingForNewStart('in-call')).toBe(false);
  });
});
