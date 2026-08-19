import { describe, expect, it } from 'vitest';
import { buildGoogleDocText } from './google-docs.js';
import type { MeetingRecord } from './meeting-store.js';

describe('buildGoogleDocText', () => {
  it('places decisions before the full transcript', () => {
    const text = buildGoogleDocText({
      id: 'meeting', source: 'google-meet', language: 'en', status: 'ready', createdAt: '2026-08-19T00:00:00.000Z', rawAudioDeleteAfter: '2026-08-20T00:00:00.000Z', audioChunks: [],
      transcript: [{ speakerLabel: 'Speaker A', startSeconds: 0, endSeconds: 1, text: 'Hello' }],
      report: { summary: 'Summary', decisions: ['Decide now'], actionItems: [], openQuestions: [], speakerStats: [{ speakerLabel: 'Speaker A', talkSeconds: 1 }] },
    } satisfies MeetingRecord);
    expect(text.indexOf('Decisions')).toBeLessThan(text.indexOf('Transcript'));
  });
});
