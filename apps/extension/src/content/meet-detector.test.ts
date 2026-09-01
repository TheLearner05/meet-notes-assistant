import { describe, expect, it } from 'vitest';
import { getMeetState, getParticipantCount, mayStartRecording } from './meet-detector.js';

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

describe('getParticipantCount', () => {
  it('reads the count from the avatar badge next to the user\'s own avatar', () => {
    const document = {
      querySelector: (selector: string) =>
        selector === '[data-avatar-count]' ? { getAttribute: (name: string) => (name === 'data-avatar-count' ? '3' : null) } : null,
    } as unknown as Document;

    expect(getParticipantCount(document)).toBe(3);
  });

  it('falls back to the People button aria-label when there is no avatar badge', () => {
    const document = {
      querySelector: (selector: string) =>
        selector === 'button[aria-label^="People -"]' ? { getAttribute: (name: string) => (name === 'aria-label' ? 'People - 2 joined' : null) } : null,
    } as unknown as Document;

    expect(getParticipantCount(document)).toBe(2);
  });

  it('returns undefined when neither signal is present', () => {
    const document = { querySelector: () => null } as unknown as Document;

    expect(getParticipantCount(document)).toBeUndefined();
  });
});
