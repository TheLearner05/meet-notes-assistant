import { describe, expect, it } from 'vitest';
import { createMeetingRecord } from './meeting-store.js';

describe('createMeetingRecord', () => {
  it('creates a new Google Meet recording in the recording state', () => {
    const meeting = createMeetingRecord('mr-en', new Date('2026-08-19T10:00:00.000Z'));

    expect(meeting).toMatchObject({
      source: 'google-meet',
      language: 'mr-en',
      status: 'recording',
      rawAudioDeleteAfter: '2026-08-20T10:00:00.000Z',
    });
    expect(meeting.id).toMatch(/^[a-z0-9-]+$/);
  });
});
