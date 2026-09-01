import { describe, expect, it } from 'vitest';
import { collapseHallucinatedRepetition, collapseHallucinatedSegmentRepeats, isSilentSegment, SILENCE_THRESHOLD_DB } from './transcription-quality.js';

describe('isSilentSegment', () => {
  it('treats audio well below the threshold as silent', () => {
    expect(isSilentSegment(-55)).toBe(true);
  });

  it('treats normal speech volume as not silent', () => {
    expect(isSilentSegment(-24)).toBe(false);
    expect(isSilentSegment(-28.7)).toBe(false);
  });

  it('treats a reading right at the threshold as silent', () => {
    expect(isSilentSegment(SILENCE_THRESHOLD_DB)).toBe(true);
  });

  it('assumes not-silent when the volume could not be measured, so audio is never skipped without evidence', () => {
    expect(isSilentSegment(undefined)).toBe(false);
  });
});

describe('collapseHallucinatedRepetition', () => {
  it('leaves normal speech untouched', () => {
    const text = 'We need to finish the login flow before the release next week.';
    expect(collapseHallucinatedRepetition(text)).toBe(text);
  });

  it('collapses a single word repeated many times into one instance', () => {
    const text = Array(200).fill('गिलते').join(' ');
    expect(collapseHallucinatedRepetition(text)).toBe('गिलते');
  });

  it('collapses a short repeated phrase into one instance', () => {
    const text = Array(10).fill('au revoir').join(' ');
    expect(collapseHallucinatedRepetition(text)).toBe('au revoir');
  });

  it('does not collapse a short text that merely repeats a common word a few times naturally', () => {
    const text = 'No, no, this is not Maserati. This is an American company.';
    expect(collapseHallucinatedRepetition(text)).toBe(text);
  });

  it('does not collapse a short run below the repetition threshold', () => {
    const text = 'word word word word rest of the sentence continues normally here';
    expect(collapseHallucinatedRepetition(text)).toBe(text);
  });

  it('finds and collapses a repeating run in the middle of otherwise-normal text', () => {
    const text = `Let's start the meeting. ${Array(8).fill('word').join(' ')} Thanks everyone for joining.`;
    expect(collapseHallucinatedRepetition(text)).toBe("Let's start the meeting. word Thanks everyone for joining.");
  });

  it('collapses a hyphen-glued numeric hallucination with no whitespace anywhere', () => {
    // Real hallucinated output captured from a live meeting: number tokens glued together with
    // hyphens and no spaces at all, e.g. "-32-33-35-...-44-45-44-45-44-45...". The alternating
    // "44"/"45" pair is the repeating unit here.
    const text = Array(15).fill('44-45').join('-');
    expect(collapseHallucinatedRepetition(text)).toBe('44-45');
  });

  it('leaves a normal sentence containing a hyphenated word completely unchanged', () => {
    const text = 'This is a well-known issue with the design.';
    expect(collapseHallucinatedRepetition(text)).toBe(text);
  });

  it('collapses a short legitimate repeated word used for emphasis', () => {
    const text = 'no no no no no no';
    expect(collapseHallucinatedRepetition(text)).toBe('no');
  });
});

describe('collapseHallucinatedSegmentRepeats', () => {
  it('leaves distinct consecutive segments from the same speaker untouched', () => {
    const transcript = [
      { speakerLabel: 'Speaker B', startSeconds: 0, endSeconds: 2, text: 'Okay.' },
      { speakerLabel: 'Speaker B', startSeconds: 2, endSeconds: 5, text: 'How much does it cost to buy a car?' },
      { speakerLabel: 'Speaker B', startSeconds: 5, endSeconds: 6, text: "That's it." },
    ];
    expect(collapseHallucinatedSegmentRepeats(transcript)).toEqual(transcript);
  });

  it('collapses a real hallucinated run: the same short sentence repeated verbatim across separate diarized segments', () => {
    // Captured from a live meeting: the model emitted "I didn't hear his own voice." as three
    // separate diarized segments in a row, each with its own timestamp, instead of real speech.
    const transcript = [
      { speakerLabel: 'Speaker B', startSeconds: 34, endSeconds: 35, text: "I didn't hear his own voice." },
      { speakerLabel: 'Speaker B', startSeconds: 35, endSeconds: 36, text: "I didn't hear his own voice." },
      { speakerLabel: 'Speaker B', startSeconds: 36, endSeconds: 37, text: "I didn't hear his own voice." },
      { speakerLabel: 'Speaker B', startSeconds: 40, endSeconds: 41, text: 'Mm-hmm.' },
    ];
    expect(collapseHallucinatedSegmentRepeats(transcript)).toEqual([
      { speakerLabel: 'Speaker B', startSeconds: 34, endSeconds: 37, text: "I didn't hear his own voice." },
      { speakerLabel: 'Speaker B', startSeconds: 40, endSeconds: 41, text: 'Mm-hmm.' },
    ]);
  });

  it('does not collapse a short run below the repetition threshold', () => {
    const transcript = [
      { speakerLabel: 'Speaker A', startSeconds: 0, endSeconds: 1, text: 'Yes.' },
      { speakerLabel: 'Speaker A', startSeconds: 1, endSeconds: 2, text: 'Yes.' },
    ];
    expect(collapseHallucinatedSegmentRepeats(transcript)).toEqual(transcript);
  });

  it('does not collapse identical text spoken by different speakers', () => {
    const transcript = [
      { speakerLabel: 'Speaker A', startSeconds: 0, endSeconds: 1, text: 'Okay.' },
      { speakerLabel: 'Speaker B', startSeconds: 1, endSeconds: 2, text: 'Okay.' },
      { speakerLabel: 'Speaker A', startSeconds: 2, endSeconds: 3, text: 'Okay.' },
    ];
    expect(collapseHallucinatedSegmentRepeats(transcript)).toEqual(transcript);
  });

  it('ignores case and surrounding whitespace when matching repeats', () => {
    const transcript = [
      { speakerLabel: 'Speaker C', startSeconds: 0, endSeconds: 1, text: 'Clown thing.' },
      { speakerLabel: 'Speaker C', startSeconds: 1, endSeconds: 2, text: ' clown thing. ' },
      { speakerLabel: 'Speaker C', startSeconds: 2, endSeconds: 3, text: 'CLOWN THING.' },
    ];
    expect(collapseHallucinatedSegmentRepeats(transcript)).toEqual([
      { speakerLabel: 'Speaker C', startSeconds: 0, endSeconds: 3, text: 'Clown thing.' },
    ]);
  });
});
