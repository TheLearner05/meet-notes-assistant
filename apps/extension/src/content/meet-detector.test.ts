import { describe, expect, it } from 'vitest';
import { getMeetState, mayStartRecording } from './meet-detector.js';

const liveCallDocument = {
  querySelector: (selector: string) =>
    selector.includes('Leave call') ? { getAttribute: () => 'Leave call' } : null,
} as unknown as Document;

const lobbyDocument = {
  querySelector: () => null,
} as unknown as Document;

describe('getMeetState', () => {
  it('recognizes a Google Meet tab with a leave-call control as an active call', () => {
    expect(getMeetState('https://meet.google.com/abc-defg-hij', liveCallDocument)).toBe('in-call');
  });

  it('does not mistake a Meet lobby for an active call', () => {
    expect(getMeetState('https://meet.google.com/abc-defg-hij', lobbyDocument)).toBe('lobby');
  });

  it('does not treat another website as a meeting', () => {
    expect(getMeetState('https://example.com/abc-defg-hij', liveCallDocument)).toBe('not-meet');
  });
});

describe('mayStartRecording', () => {
  it('requires both an active call and an explicit user click', () => {
    expect(mayStartRecording('in-call', false)).toBe(false);
    expect(mayStartRecording('lobby', true)).toBe(false);
    expect(mayStartRecording('in-call', true)).toBe(true);
  });
});
