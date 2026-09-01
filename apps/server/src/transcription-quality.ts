import { spawn } from 'node:child_process';
import type { TranscriptSegment } from './meeting-store.js';

// Whisper-family transcription models are known to hallucinate plausible-sounding but fabricated
// text when fed silence or near-silent audio (long waiting periods before a meeting starts, dead
// air, background noise with no speech). A segment measured this quiet almost never contains real
// speech, so it's skipped before ever reaching the transcription API rather than risking invented content.
export const SILENCE_THRESHOLD_DB = -45;

const MIN_REPEAT_UNIT_WORDS = 1;
const MAX_REPEAT_UNIT_WORDS = 4;
const MIN_REPEAT_COUNT = 5;
const MIN_SEGMENT_REPEAT_COUNT = 3;

export function isSilentSegment(meanVolumeDb: number | undefined, thresholdDb = SILENCE_THRESHOLD_DB): boolean {
  return meanVolumeDb !== undefined && meanVolumeDb <= thresholdDb;
}

export async function measureMeanVolumeDb(audioPath: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    const process = spawn('ffmpeg', ['-hide_banner', '-i', audioPath, '-af', 'volumedetect', '-f', 'null', '-'], { windowsHide: true });
    let output = '';
    process.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    process.once('error', () => resolve(undefined));
    process.once('close', () => {
      const match = output.match(/mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/);
      resolve(match ? Number(match[1]) : undefined);
    });
  });
}

// A second, independent backstop against the same hallucination failure mode: even audio that
// isn't silent overall can contain a brief unclear moment that sends the model into a degenerate
// loop, repeating a short phrase dozens or hundreds of times in a row. Collapsing that run to a
// single instance keeps the transcript honest about "something unclear happened here" instead of
// presenting hundreds of fabricated repeated lines as real speech.
//
// Tokens are alphanumeric clusters (via Unicode property escapes, so any script's "words" and
// digit runs like "44"/"45" both count), tracked by their original character offsets rather than
// whitespace-split. Some hallucinations have no whitespace at all — e.g. a run of numbers glued
// together with hyphens ("44-45-44-45-...") — so splitting on \s+ would see that as one giant
// "word" and never detect the repetition. Reconstructing via offset slicing (instead of rejoining
// tokens with spaces) also means ordinary punctuation/spacing outside the collapsed run — like the
// hyphen in "well-known" — is never disturbed.
export function collapseHallucinatedRepetition(text: string): string {
  const matches = [...text.matchAll(/[\p{L}\p{N}]+/gu)];
  if (!matches.length) return text;
  const tokens = matches.map((m) => m[0]);
  const starts = matches.map((m) => m.index!);
  const ends = matches.map((m, i) => starts[i] + tokens[i].length);

  for (let unitLength = MIN_REPEAT_UNIT_WORDS; unitLength <= MAX_REPEAT_UNIT_WORDS; unitLength++) {
    for (let start = 0; start + unitLength * MIN_REPEAT_COUNT <= tokens.length; start++) {
      const unitKey = tokens.slice(start, start + unitLength).join(' ').toLowerCase();
      let repeatCount = 1;
      let cursor = start + unitLength;
      while (cursor + unitLength <= tokens.length && tokens.slice(cursor, cursor + unitLength).join(' ').toLowerCase() === unitKey) {
        repeatCount += 1;
        cursor += unitLength;
      }
      if (repeatCount >= MIN_REPEAT_COUNT) {
        const before = text.slice(0, starts[start]);
        const unitText = text.slice(starts[start], ends[start + unitLength - 1]);
        const after = text.slice(ends[cursor - 1]);
        return (before + unitText + after).trim();
      }
    }
  }
  return text;
}

// A third backstop against the same hallucination failure mode, at the widest granularity: the
// model can also emit the exact same short sentence as several separate diarized segments in a
// row (each with its own timestamp), rather than as repeated words inside one segment's text.
// collapseHallucinatedRepetition can't see this because each segment's text is independently
// well-formed — the repetition only shows up once you look across segments. A run of identical
// (speaker, normalized text) pairs collapses to a single segment spanning the whole run's time
// range; shorter runs are left alone since a couple of genuine short repeats (e.g. two "Okay."s)
// are common in real conversation.
export function collapseHallucinatedSegmentRepeats(transcript: TranscriptSegment[], minRepeatCount = MIN_SEGMENT_REPEAT_COUNT): TranscriptSegment[] {
  const result: TranscriptSegment[] = [];
  let runStart = 0;
  while (runStart < transcript.length) {
    let runEnd = runStart + 1;
    while (runEnd < transcript.length && isSameSpeakerAndText(transcript[runEnd], transcript[runStart])) runEnd += 1;
    result.push(runEnd - runStart >= minRepeatCount
      ? { ...transcript[runStart], endSeconds: transcript[runEnd - 1].endSeconds }
      : transcript[runStart]);
    if (runEnd - runStart < minRepeatCount) { for (let i = runStart + 1; i < runEnd; i++) result.push(transcript[i]); }
    runStart = runEnd;
  }
  return result;
}
function isSameSpeakerAndText(a: TranscriptSegment, b: TranscriptSegment): boolean {
  return a.speakerLabel === b.speakerLabel && a.text.trim().toLowerCase() === b.text.trim().toLowerCase();
}
