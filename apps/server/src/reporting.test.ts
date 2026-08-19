import { describe, expect, it } from 'vitest';
import { calculateSpeakerStats, parseMeetingReport } from './reporting.js';

describe('calculateSpeakerStats', () => {
  it('adds speaking time by speaker label', () => {
    expect(calculateSpeakerStats([
      { speakerLabel: 'Speaker A', startSeconds: 0, endSeconds: 7, text: 'नमस्कार' },
      { speakerLabel: 'Speaker B', startSeconds: 7, endSeconds: 10, text: 'Hello' },
      { speakerLabel: 'Speaker A', startSeconds: 10, endSeconds: 15, text: 'Thanks' },
    ])).toEqual([
      { speakerLabel: 'Speaker A', talkSeconds: 12 },
      { speakerLabel: 'Speaker B', talkSeconds: 3 },
    ]);
  });
});

describe('parseMeetingReport', () => {
  it('keeps the meeting usable when the AI returns an empty summary response', () => {
    const report = parseMeetingReport('', [
      { speakerLabel: 'Speaker A', startSeconds: 0, endSeconds: 4, text: 'नमस्कार' },
    ]);

    expect(report).toEqual({
      summary: 'The transcript was saved, but an AI summary was unavailable.',
      decisions: [],
      actionItems: [],
      openQuestions: [],
      speakerStats: [{ speakerLabel: 'Speaker A', talkSeconds: 4 }],
    });
  });

  it('keeps the meeting usable when the AI response is incomplete JSON', () => {
    const report = parseMeetingReport('{"summary":"Partially', []);

    expect(report.summary).toBe('The transcript was saved, but an AI summary was unavailable.');
  });
});
