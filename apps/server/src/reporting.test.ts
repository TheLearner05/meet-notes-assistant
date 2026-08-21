import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('rebuilds incomplete live fragments into complete initial notes after the meeting', async () => {
    const { store, root, meeting } = await createTestMeeting();
    await store.saveChunk(meeting.id, '0', Buffer.from('audio'));
    await store.saveChunk(meeting.id, '1', Buffer.from('audio'));
    await store.update(meeting.id, (item) => {
      item.provisionalTranscript = [{ speakerLabel: 'Speaker pending', startSeconds: 0, endSeconds: 30, text: 'Only the first fragment' }];
    });

    const segment = vi.fn(async () => [
      { audioPath: join(root, 'first.webm'), batchIndex: 0, startSeconds: 0 },
      { audioPath: join(root, 'second.webm'), batchIndex: 1, startSeconds: 600 },
    ]);
    await processProvisionalMeeting(store, meeting.id, async () => undefined, async () => JSON.stringify({ summary: 'Complete notes', decisions: [], actionItems: [], openQuestions: [] }), {
      dataRoot: root,
      transcribe: async (audioPath) => audioPath.endsWith('first.webm') ? 'First complete section' : 'Second complete section',
      segmentAudio: segment,
    });

    const saved = await store.get(meeting.id);
    expect(segment).toHaveBeenCalledOnce();
    expect(saved?.provisionalTranscript.map((item) => item.text)).toEqual(['First complete section', 'Second complete section']);
    expect(saved?.provisionalTranscript.map((item) => item.startSeconds)).toEqual([0, 600]);
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
    }, async () => [{ audioPath: join(root, 'section.webm'), batchIndex: 0, startSeconds: 0 }]);

    const saved = await store.get(meeting.id);
    expect(saved?.status).toBe('ready');
    expect(saved?.processingStage).toBe('initial_ready');
    expect(saved?.report?.summary).toBe('Initial notes');
    expect(saved?.finalError).toBe('Diarization temporarily unavailable');
  });

  it('splits long recordings into diarization-safe sections with correct transcript offsets', async () => {
    const { store, root, meeting } = await createTestMeeting();
    for (let sequence = 0; sequence < 36; sequence += 1) await store.saveChunk(meeting.id, String(sequence), Buffer.from(`audio-${sequence}`));
    const audioPaths: string[] = [];
    const segment = vi.fn(async () => [
      { audioPath: join(root, 'first.webm'), batchIndex: 0, startSeconds: 0 },
      { audioPath: join(root, 'second.webm'), batchIndex: 1, startSeconds: 1050 },
    ]);

    await processFinalDiarizedMeeting(store, meeting.id, root, {
      diarize: async (audioPath) => {
        audioPaths.push(audioPath);
        return { segments: [{ speaker: 'A', start: 0, end: 10, text: 'Discussion' }] };
      },
      summarize: async () => JSON.stringify({ summary: 'Done', decisions: [], actionItems: [], openQuestions: [] }),
    }, segment);

    const saved = await store.get(meeting.id);
    expect(segment).toHaveBeenCalledOnce();
    expect(audioPaths).toHaveLength(2);
    expect(saved?.processingStage).toBe('final_ready');
    expect(saved?.finalTranscript).toMatchObject([
      { speakerLabel: 'Speaker A', startSeconds: 0 },
      { speakerLabel: 'Speaker 2-A', startSeconds: 1050 },
    ]);
  });

  it('keeps final sections in time order and records completed speaker work', async () => {
    const { store, root, meeting } = await createTestMeeting();
    await store.saveChunk(meeting.id, '0', Buffer.from('audio'));
    const segment = async () => [
      { audioPath: join(root, 'first.webm'), batchIndex: 0, startSeconds: 0 },
      { audioPath: join(root, 'second.webm'), batchIndex: 1, startSeconds: 600 },
    ];

    await processFinalDiarizedMeeting(store, meeting.id, root, {
      diarize: async (audioPath) => {
        if (audioPath.endsWith('first.webm')) await new Promise((done) => setTimeout(done, 20));
        return { segments: [{ speaker: 'A', start: 0, end: 3, text: audioPath.endsWith('first.webm') ? 'first' : 'second' }] };
      },
      summarize: async () => '{}',
    }, segment);

    const saved = await store.get(meeting.id);
    expect(saved?.finalTranscript.map((item) => item.text)).toEqual(['first', 'second']);
    expect(saved?.processingProgress).toEqual({ completed: 2, total: 2 });
  });

  it('retries a timed-out speaker section', async () => {
    const { store, root, meeting } = await createTestMeeting();
    await store.saveChunk(meeting.id, '0', Buffer.from('audio'));
    let calls = 0;

    await processFinalDiarizedMeeting(store, meeting.id, root, {
      diarize: async () => {
        calls += 1;
        if (calls === 1) throw new Error('Request timed out.');
        return { segments: [{ speaker: 'A', start: 0, end: 1, text: 'recovered' }] };
      },
      summarize: async () => '{}',
    }, async () => [{ audioPath: join(root, 'section.webm'), batchIndex: 0, startSeconds: 0 }]);

    expect(calls).toBe(2);
    expect((await store.get(meeting.id))?.finalTranscript[0]?.text).toBe('recovered');
  });
});
