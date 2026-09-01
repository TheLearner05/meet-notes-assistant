import { describe, expect, it } from 'vitest';
import { buildRunningDocumentText, selectRunningDocumentMeetings } from './microsoft-word-export.js';
import type { MeetingRecord } from './meeting-store.js';

function fixtureMeeting(overrides: Partial<MeetingRecord>): MeetingRecord {
  return {
    id: 'meeting', source: 'google-meet', language: 'en', status: 'ready', processingStage: 'final_ready',
    createdAt: '2026-08-19T00:00:00.000Z', updatedAt: '2026-08-19T00:00:00.000Z', rawAudioDeleteAfter: '2026-08-20T00:00:00.000Z',
    audioChunks: [], provisionalTranscript: [], finalTranscript: [], transcript: [],
    ...overrides,
  } as MeetingRecord;
}

const report = { summary: 'Summary text', decisions: ['Ship it'], actionItems: [{ text: 'Send quote', ownerSpeakerLabel: 'Speaker A', dueDate: '2026-08-25' }], openQuestions: [], speakerStats: [{ speakerLabel: 'Speaker A', talkSeconds: 30 }] };

describe('selectRunningDocumentMeetings', () => {
  it('keeps only ready meetings that have a report, oldest first', () => {
    const older = fixtureMeeting({ id: 'a', createdAt: '2026-08-19T00:00:00.000Z', status: 'ready', report });
    const newer = fixtureMeeting({ id: 'b', createdAt: '2026-08-20T00:00:00.000Z', status: 'ready', report });
    const recording = fixtureMeeting({ id: 'c', status: 'recording' });
    const noReport = fixtureMeeting({ id: 'd', status: 'ready' });

    expect(selectRunningDocumentMeetings([newer, recording, older, noReport]).map((m) => m.id)).toEqual(['a', 'b']);
  });
});

describe('buildRunningDocumentText', () => {
  it('includes each meeting\'s summary, decisions, and action items', () => {
    const meeting = fixtureMeeting({ status: 'ready', report, finalReport: report, transcript: [{ speakerLabel: 'Speaker A', startSeconds: 0, endSeconds: 3, text: 'Hello' }] });
    const text = buildRunningDocumentText([meeting]);
    expect(text).toContain('Summary text');
    expect(text).toContain('Ship it');
    expect(text).toContain('Send quote — Speaker A (due 2026-08-25)');
  });

  it('separates multiple meetings with a visible divider, in chronological order', () => {
    const first = fixtureMeeting({ id: 'a', createdAt: '2026-08-19T00:00:00.000Z', status: 'ready', report: { ...report, summary: 'First meeting summary' } });
    const second = fixtureMeeting({ id: 'b', createdAt: '2026-08-20T00:00:00.000Z', status: 'ready', report: { ...report, summary: 'Second meeting summary' } });
    const text = buildRunningDocumentText([second, first]);
    expect(text.indexOf('First meeting summary')).toBeLessThan(text.indexOf('Second meeting summary'));
    expect(text).toContain('====');
  });
});
