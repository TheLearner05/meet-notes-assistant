import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MeetingStore } from './meeting-store.js';
import { calculateSpeakerStats, parseMeetingReport, processFinalDiarizedMeeting, processProvisionalMeeting, reportAsMarkdown, transcriptDateTime } from './reporting.js';

const temporaryFolders: string[] = [];
afterEach(async () => { await Promise.all(temporaryFolders.splice(0).map((folder) => rm(folder, { recursive: true, force: true }))); });

async function createTestMeeting() {
  const root = await mkdtemp(join(tmpdir(), 'meet-notes-reporting-'));
  temporaryFolders.push(root);
  const store = new MeetingStore(root);
  await store.init();
  return { store, root, meeting: await store.create('hi-en') };
}

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

describe('transcriptDateTime', () => {
  it('adds the segment offset to the real recording start time', () => {
    expect(transcriptDateTime('2026-08-20T04:30:00.000Z', 65).toISOString())
      .toBe('2026-08-20T04:31:05.000Z');
  });
});

describe('fast and final reports', () => {
  it('publishes a speaker-pending initial report once chunk transcription is flushed', async () => {
    const { store, meeting } = await createTestMeeting();
    await store.update(meeting.id, (item) => {
      item.provisionalTranscript = [{ speakerLabel: 'Speaker pending', startSeconds: 0, endSeconds: 30, text: 'We will launch on Monday.' }];
    });

    await processProvisionalMeeting(store, meeting.id, async () => undefined, async () => JSON.stringify({ summary: 'Launch is planned for Monday.', decisions: ['Launch Monday'], actionItems: [], openQuestions: [] }));

    const saved = await store.get(meeting.id);
    expect(saved?.processingStage).toBe('initial_ready');
    expect(saved?.status).toBe('ready');
    expect(saved?.provisionalReport?.summary).toBe('Launch is planned for Monday.');
    expect(saved?.report).toEqual(saved?.provisionalReport);
    expect(reportAsMarkdown(saved!)).toContain('Initial notes — speaker attribution pending');
  });

  it('keeps initial notes available if the later speaker report fails', async () => {
    const { store, root, meeting } = await createTestMeeting();
    await store.saveChunk(meeting.id, '0', Buffer.from('audio'));
    await store.update(meeting.id, (item) => {
      item.status = 'ready';
      item.processingStage = 'initial_ready';
      item.provisionalTranscript = [{ speakerLabel: 'Speaker pending', startSeconds: 0, endSeconds: 30, text: 'नमस्कार' }];
      item.provisionalReport = parseMeetingReport(JSON.stringify({ summary: 'Initial notes', decisions: [], actionItems: [], openQuestions: [] }), item.provisionalTranscript);
      item.report = item.provisionalReport;
    });

    await processFinalDiarizedMeeting(store, meeting.id, root, {
      diarize: async () => { throw new Error('Diarization temporarily unavailable'); },
      summarize: async () => '{}',
    });

    const saved = await store.get(meeting.id);
    expect(saved?.status).toBe('ready');
    expect(saved?.processingStage).toBe('initial_ready');
    expect(saved?.report?.summary).toBe('Initial notes');
    expect(saved?.finalError).toBe('Diarization temporarily unavailable');
  });
});
