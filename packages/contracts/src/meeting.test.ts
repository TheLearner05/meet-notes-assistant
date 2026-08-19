import { describe, expect, it } from 'vitest';
import { createMeetingInputSchema } from './meeting.js';

describe('createMeetingInputSchema', () => {
  it('accepts a Marathi-English Google Meet meeting', () => {
    expect(
      createMeetingInputSchema.parse({
        source: 'google-meet',
        language: 'mr-en',
      }),
    ).toEqual({
      source: 'google-meet',
      language: 'mr-en',
    });
  });

  it('rejects unsupported meeting languages', () => {
    expect(() =>
      createMeetingInputSchema.parse({ source: 'google-meet', language: 'fr' }),
    ).toThrow();
  });
});
