import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeetingStore } from './meeting-store.js';
import { calculateSpeakerStats, mappingsToRecord, parseMeetingReport, processFinalDiarizedMeeting, processProvisionalMeeting, reportAsMarkdown, transcriptDateTime } from './reporting.js';

const temporaryFolders: string[] = [];
afterEach(async () => { await Promise.all(temporaryFolders.splice(0).map((folder) => rm(folder, { recursive: true, force: true }))); });

const notSilent = async () => -20;

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

  it('keeps the meeting usable when the AI response is valid JSON but not an object', () => {
    const report = parseMeetingReport('"just a string"', []);

    expect(report.summary).toBe('The transcript was saved, but an AI summary was unavailable.');
  });

  it('trusts a schema-conformant report object without re-validating every field', () => {
    const report = parseMeetingReport(JSON.stringify({
      summary: 'Launch review',
      decisions: ['Ship Friday'],
      actionItems: [{ text: 'File the ticket', ownerSpeakerLabel: 'Speaker A', dueDate: null }],
      openQuestions: ['Who owns rollback?'],
    }), []);

    expect(report.summary).toBe('Launch review');
    expect(report.decisions).toEqual(['Ship Friday']);
    expect(report.actionItems).toEqual([{ text: 'File the ticket', ownerSpeakerLabel: 'Speaker A', dueDate: null }]);
    expect(report.openQuestions).toEqual(['Who owns rollback?']);
  });
});

describe('mappingsToRecord', () => {
  it('converts a from/to mapping array into a lookup record', () => {
    expect(mappingsToRecord([
      { from: 'Speaker A', to: 'Speaker A' },
      { from: 'Speaker 2-A', to: 'Speaker A' },
    ])).toEqual({ 'Speaker A': 'Speaker A', 'Speaker 2-A': 'Speaker A' });
  });

  it('returns undefined for a missing or non-array mappings field', () => {
    expect(mappingsToRecord(undefined)).toBeUndefined();
    expect(mappingsToRecord(null)).toBeUndefined();
  });

  it('drops entries with a non-string from or to', () => {
    expect(mappingsToRecord([
      { from: 'Speaker A', to: 'Speaker A' },
      { from: 42, to: 'Speaker A' },
    ] as never)).toEqual({ 'Speaker A': 'Speaker A' });
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
      measureVolume: notSilent,
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
    }, async () => [{ audioPath: join(root, 'section.webm'), batchIndex: 0, startSeconds: 0 }], notSilent);

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
    }, segment, notSilent);

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
    }, segment, notSilent);

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
    }, async () => [{ audioPath: join(root, 'section.webm'), batchIndex: 0, startSeconds: 0 }], notSilent);

    expect(calls).toBe(2);
    expect((await store.get(meeting.id))?.finalTranscript[0]?.text).toBe('recovered');
  });

  it('never sends a near-silent section to the speaker-analysis model, to avoid hallucinated transcripts', async () => {
    const { store, root, meeting } = await createTestMeeting();
    await store.saveChunk(meeting.id, '0', Buffer.from('audio'));
    let diarizeCalls = 0;
    const segment = async () => [
      { audioPath: join(root, 'quiet-section.webm'), batchIndex: 0, startSeconds: 0 },
      { audioPath: join(root, 'loud-section.webm'), batchIndex: 1, startSeconds: 600 },
    ];

    await processFinalDiarizedMeeting(store, meeting.id, root, {
      diarize: async (audioPath) => {
        diarizeCalls += 1;
        return { segments: [{ speaker: 'A', start: 0, end: 3, text: audioPath.includes('loud') ? 'Real speech' : 'Should never be called for the quiet section' }] };
      },
      summarize: async () => '{}',
    }, segment, async (audioPath) => audioPath.includes('quiet') ? -60 : -20);

    expect(diarizeCalls).toBe(1);
    const saved = await store.get(meeting.id);
    expect(saved?.finalTranscript.map((item) => item.text)).toEqual(['Real speech']);
  });

  it('collapses a hallucinated repetition loop in a diarized section into a single instance', async () => {
    const { store, root, meeting } = await createTestMeeting();
    await store.saveChunk(meeting.id, '0', Buffer.from('audio'));

    await processFinalDiarizedMeeting(store, meeting.id, root, {
      diarize: async () => ({ segments: [{ speaker: 'A', start: 0, end: 3, text: Array(50).fill('गिलते').join(' ') }] }),
      summarize: async () => '{}',
    }, async () => [{ audioPath: join(root, 'section.webm'), batchIndex: 0, startSeconds: 0 }], notSilent);

    expect((await store.get(meeting.id))?.finalTranscript[0]?.text).toBe('गिलते');
  });

  it('collapses a hallucinated sentence repeated across separate diarized segments in one section', async () => {
    const { store, root, meeting } = await createTestMeeting();
    await store.saveChunk(meeting.id, '0', Buffer.from('audio'));

    await processFinalDiarizedMeeting(store, meeting.id, root, {
      diarize: async () => ({
        segments: [
          { speaker: 'B', start: 34, end: 35, text: "I didn't hear his own voice." },
          { speaker: 'B', start: 35, end: 36, text: "I didn't hear his own voice." },
          { speaker: 'B', start: 36, end: 37, text: "I didn't hear his own voice." },
          { speaker: 'B', start: 40, end: 41, text: 'Real speech continues here.' },
        ],
      }),
      summarize: async () => '{}',
    }, async () => [{ audioPath: join(root, 'section.webm'), batchIndex: 0, startSeconds: 0 }], notSilent);

    const saved = await store.get(meeting.id);
    expect(saved?.finalTranscript.map((item) => item.text)).toEqual(["I didn't hear his own voice.", 'Real speech continues here.']);
    expect(saved?.finalTranscript[0]).toMatchObject({ startSeconds: 34, endSeconds: 37 });
  });

  it('reconciles chunk-fragmented speaker labels into one canonical label per real person', async () => {
    const { store, root, meeting } = await createTestMeeting();
    await store.saveChunk(meeting.id, '0', Buffer.from('audio'));
    const segment = async () => [
      { audioPath: join(root, 'first.webm'), batchIndex: 0, startSeconds: 0 },
      { audioPath: join(root, 'second.webm'), batchIndex: 1, startSeconds: 600 },
    ];
    const reconcileSpeakers = vi.fn(async () => ({ 'Speaker A': 'Speaker A', 'Speaker 2-A': 'Speaker A' }));

    await processFinalDiarizedMeeting(store, meeting.id, root, {
      diarize: async (audioPath) => ({ segments: [{ speaker: 'A', start: 0, end: audioPath.endsWith('first.webm') ? 10 : 5, text: audioPath.endsWith('first.webm') ? 'Hello' : 'World' }] }),
      summarize: async () => JSON.stringify({ summary: 'Done', decisions: [], actionItems: [], openQuestions: [] }),
      reconcileSpeakers,
    }, segment, notSilent);

    const saved = await store.get(meeting.id);
    expect(reconcileSpeakers).toHaveBeenCalledWith(expect.any(String), ['Speaker 2-A', 'Speaker A']);
    expect(saved?.finalTranscript.map((item) => item.speakerLabel)).toEqual(['Speaker A', 'Speaker A']);
    expect(saved?.finalReport?.speakerStats).toEqual([{ speakerLabel: 'Speaker A', talkSeconds: 15 }]);
  });

  it('does not call reconcileSpeakers when only one distinct speaker label is present', async () => {
    const { store, root, meeting } = await createTestMeeting();
    await store.saveChunk(meeting.id, '0', Buffer.from('audio'));
    const reconcileSpeakers = vi.fn(async () => ({}));

    await processFinalDiarizedMeeting(store, meeting.id, root, {
      diarize: async () => ({ segments: [{ speaker: 'A', start: 0, end: 3, text: 'Only speaker' }] }),
      summarize: async () => '{}',
      reconcileSpeakers,
    }, async () => [{ audioPath: join(root, 'section.webm'), batchIndex: 0, startSeconds: 0 }], notSilent);

    expect(reconcileSpeakers).not.toHaveBeenCalled();
    expect((await store.get(meeting.id))?.finalTranscript[0]?.speakerLabel).toBe('Speaker A');
  });

  it('keeps the meeting successful with original labels when speaker reconciliation fails', async () => {
    const { store, root, meeting } = await createTestMeeting();
    await store.saveChunk(meeting.id, '0', Buffer.from('audio'));
    const segment = async () => [
      { audioPath: join(root, 'first.webm'), batchIndex: 0, startSeconds: 0 },
      { audioPath: join(root, 'second.webm'), batchIndex: 1, startSeconds: 600 },
    ];

    await processFinalDiarizedMeeting(store, meeting.id, root, {
      diarize: async (audioPath) => ({ segments: [{ speaker: 'A', start: 0, end: 3, text: audioPath.endsWith('first.webm') ? 'Hello' : 'World' }] }),
      summarize: async () => JSON.stringify({ summary: 'Done', decisions: [], actionItems: [], openQuestions: [] }),
      reconcileSpeakers: async () => { throw new Error('reconciliation unavailable'); },
    }, segment, notSilent);

    const saved = await store.get(meeting.id);
    expect(saved?.status).toBe('ready');
    expect(saved?.processingStage).toBe('final_ready');
    expect(saved?.finalTranscript.map((item) => item.speakerLabel)).toEqual(['Speaker A', 'Speaker 2-A']);
  });

  it('logs when speaker reconciliation fails, so a silent failure is visible instead of just leaving unmerged labels', async () => {
    const { store, root, meeting } = await createTestMeeting();
    await store.saveChunk(meeting.id, '0', Buffer.from('audio'));
    const segment = async () => [
      { audioPath: join(root, 'first.webm'), batchIndex: 0, startSeconds: 0 },
      { audioPath: join(root, 'second.webm'), batchIndex: 1, startSeconds: 600 },
    ];
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await processFinalDiarizedMeeting(store, meeting.id, root, {
      diarize: async (audioPath) => ({ segments: [{ speaker: 'A', start: 0, end: 3, text: audioPath.endsWith('first.webm') ? 'Hello' : 'World' }] }),
      summarize: async () => JSON.stringify({ summary: 'Done', decisions: [], actionItems: [], openQuestions: [] }),
      reconcileSpeakers: async () => { throw new Error('reconciliation unavailable'); },
    }, segment, notSilent);

    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('Speaker reconciliation failed'), expect.any(Error));
    consoleError.mockRestore();
  });

  it('ignores an invented speaker label in the reconciliation mapping while applying valid entries in the same mapping', async () => {
    const { store, root, meeting } = await createTestMeeting();
    await store.saveChunk(meeting.id, '0', Buffer.from('audio'));
    const segment = async () => [
      { audioPath: join(root, 'first.webm'), batchIndex: 0, startSeconds: 0 },
      { audioPath: join(root, 'second.webm'), batchIndex: 1, startSeconds: 600 },
      { audioPath: join(root, 'third.webm'), batchIndex: 2, startSeconds: 1200 },
    ];

    await processFinalDiarizedMeeting(store, meeting.id, root, {
      diarize: async (audioPath) => {
        const text = audioPath.endsWith('first.webm') ? 'Hello' : audioPath.endsWith('second.webm') ? 'World' : 'Third';
        return { segments: [{ speaker: 'A', start: 0, end: 3, text }] };
      },
      summarize: async () => JSON.stringify({ summary: 'Done', decisions: [], actionItems: [], openQuestions: [] }),
      reconcileSpeakers: async () => ({ 'Speaker A': 'Speaker A', 'Speaker 2-A': 'Speaker A', 'Speaker 3-A': 'Made Up Speaker' }),
    }, segment, notSilent);

    const saved = await store.get(meeting.id);
    expect(saved?.finalTranscript.map((item) => item.speakerLabel)).toEqual(['Speaker A', 'Speaker A', 'Speaker 3-A']);
  });
});
