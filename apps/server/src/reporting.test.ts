import { describe, expect, it } from 'vitest';
import { calculateSpeakerStats } from './reporting.js';

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
