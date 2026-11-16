import { createReadStream } from 'node:fs';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import OpenAI from 'openai';
import type { MeetingLanguage, MeetingRecord, MeetingReport, MeetingStore, TranscriptSegment } from './meeting-store.js';
import { retryTransient } from './processing-retry.js';
import { openAiLanguageCode, openAiVocabulary, transcriptionPrompt } from './transcription-config.js';
import { collapseHallucinatedRepetition, collapseHallucinatedSegmentRepeats, isSilentSegment, measureMeanVolumeDb } from './transcription-quality.js';

export type MeetingAi = {
  diarize: (audioPath: string, language: MeetingLanguage) => Promise<{ text?: string; segments?: { speaker?: string; start?: number; end?: number; text?: string }[] }>;
  summarize: (transcriptText: string, userNotes?: string) => Promise<string | null | undefined>;
  transcribe?: (audioPath: string, language: MeetingLanguage) => Promise<string>;
  reconcileSpeakers?: (transcriptText: string, speakerLabels: string[]) => Promise<Record<string, string> | null | undefined>;
};
export type DiarizationAudioSegment = { audioPath: string; batchIndex: number; startSeconds: number };
export type DiarizationSegmenter = (sourceAudioPath: string, audioDirectory: string, meetingId: string) => Promise<DiarizationAudioSegment[]>;
export type VolumeMeasurer = (audioPath: string) => Promise<number | undefined>;
export type ProvisionalProcessingOptions = { dataRoot?: string; transcribe?: (audioPath: string, language: MeetingLanguage) => Promise<string>; segmentAudio?: DiarizationSegmenter; measureVolume?: VolumeMeasurer };

export function calculateSpeakerStats(segments: TranscriptSegment[]): { speakerLabel: string; talkSeconds: number }[] {
  const totals = new Map<string, number>();
  for (const segment of segments) totals.set(segment.speakerLabel, (totals.get(segment.speakerLabel) ?? 0) + Math.max(0, segment.endSeconds - segment.startSeconds));
  return [...totals.entries()].map(([speakerLabel, talkSeconds]) => ({ speakerLabel, talkSeconds })).sort((a, b) => b.talkSeconds - a.talkSeconds);
}

export function transcriptDateTime(recordingStartedAt: string, segmentStartSeconds: number): Date {
  const recordingStart = new Date(recordingStartedAt);
  if (Number.isNaN(recordingStart.getTime())) throw new Error('Meeting start time is invalid');
  return new Date(recordingStart.getTime() + Math.max(0, segmentStartSeconds) * 1000);
}

function formatTranscriptDateTime(recordingStartedAt: string, segmentStartSeconds: number): string {
  return transcriptDateTime(recordingStartedAt, segmentStartSeconds).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
}

// The OpenAI call behind `summarize` uses a strict json_schema response_format (see
// MEETING_REPORT_SCHEMA below), so a successful, non-empty response is already guaranteed to
// match this shape — no per-field re-validation needed. The fallback below only has to cover the
// cases schema conformance can't: an empty/missing response, or JSON.parse failing outright.
export function parseMeetingReport(content: string | null | undefined, transcript: TranscriptSegment[]): MeetingReport {
  const fallback: MeetingReport = { summary: 'The transcript was saved, but an AI summary was unavailable.', decisions: [], actionItems: [], openQuestions: [], speakerStats: calculateSpeakerStats(transcript) };
  if (!content?.trim()) return fallback;
  try {
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback;
    return { ...(parsed as Omit<MeetingReport, 'speakerStats'>), speakerStats: fallback.speakerStats };
  } catch { return fallback; }
}

// reconcileSpeakers can't use a strict json_schema object with dynamic keys (strict mode requires
// a closed, named property set), so the model returns an array of {from, to} pairs instead; this
// converts that array back into the Record<string, string> lookup the rest of the code expects.
export function mappingsToRecord(mappings: { from?: unknown; to?: unknown }[] | null | undefined): Record<string, string> | undefined {
  if (!Array.isArray(mappings)) return undefined;
  const record: Record<string, string> = {};
  for (const item of mappings) {
    if (item && typeof item.from === 'string' && typeof item.to === 'string') record[item.from] = item.to;
  }
  return Object.keys(record).length ? record : undefined;
}

export function reportAsMarkdown(meeting: MeetingRecord): string {
  const report = meeting.finalReport ?? meeting.provisionalReport ?? meeting.report;
  const transcript = meeting.finalTranscript.length ? meeting.finalTranscript : meeting.provisionalTranscript.length ? meeting.provisionalTranscript : meeting.transcript;
  const isInitial = !meeting.finalReport && Boolean(meeting.provisionalReport);
  if (!report) return '# Meeting report\n\nThe report is not ready yet.';
  const heading = meeting.title ? `# ${meeting.title}\n\n` : '# Meeting report\n\n';
  const actions = report.actionItems.map((item) => `- ${item.text}${item.ownerSpeakerLabel ? ` — ${item.ownerSpeakerLabel}` : ''}${item.dueDate ? ` (due ${item.dueDate})` : ''}`).join('\n') || '- None stated';
  const formattedTranscript = transcript.map((item) => `**${item.speakerLabel}** [${formatTranscriptDateTime(meeting.createdAt, item.startSeconds)}] ${item.text}`).join('\n\n');
  const userNotesSection = meeting.userNotes ? `## Attendee scratchpad notes\n${meeting.userNotes}\n\n` : '';
  return `${heading}${isInitial ? '## Initial notes — speaker attribution pending\n\n' : ''}${userNotesSection}## Summary\n${report.summary}\n\n## Decisions\n${report.decisions.map((item) => `- ${item}`).join('\n') || '- None stated'}\n\n## Action items\n${actions}\n\n## Open questions\n${report.openQuestions.map((item) => `- ${item}`).join('\n') || '- None stated'}\n\n## Speaker report\n${report.speakerStats.map((item) => `- ${item.speakerLabel}: ${Math.round(item.talkSeconds)} seconds`).join('\n')}\n\n## Transcript\n${formattedTranscript}`;
}

export async function processProvisionalMeeting(store: MeetingStore, meetingId: string, flushChunks: (meetingId: string) => Promise<void>, summarize?: (transcriptText: string, userNotes?: string) => Promise<string | null | undefined>, options: ProvisionalProcessingOptions = {}): Promise<void> {
  try {
    await store.update(meetingId, (item) => { item.status = 'processing'; item.processingStage = 'transcribing_fast'; item.error = undefined; item.provisionalError = undefined; });
    await flushChunks(meetingId);
    const meeting = await requireMeeting(store, meetingId);
    let transcript = meeting.provisionalTranscript;
    if (options.dataRoot && transcript.length < meeting.audioChunks.length) {
      transcript = await rebuildProvisionalTranscript(store, meeting, options.dataRoot, options.transcribe ?? createOpenAiMeetingAi().transcribe!, options.segmentAudio ?? segmentFastTranscriptionAudio, options.measureVolume ?? measureMeanVolumeDb);
      await store.update(meetingId, (item) => { item.provisionalTranscript = transcript; });
    }
    if (!transcript.length) throw new Error('The recording did not contain transcribable speech.');
    const report = parseMeetingReport(await (summarize ?? createOpenAiMeetingAi().summarize)(transcriptAsText(transcript), meeting.userNotes), transcript);
    await store.update(meetingId, (item) => { item.provisionalReport = report; item.report = report; item.transcript = transcript; item.status = 'ready'; item.processingStage = 'initial_ready'; item.error = undefined; });
  } catch (error) {
    await store.update(meetingId, (item) => { item.status = 'failed'; item.processingStage = 'failed'; item.error = errorMessage(error); item.provisionalError = item.error; });
  }
}

export async function processFinalDiarizedMeeting(store: MeetingStore, meetingId: string, dataRoot: string, ai?: MeetingAi, segmentAudio: DiarizationSegmenter = segmentDiarizationAudio, measureVolume: VolumeMeasurer = measureMeanVolumeDb): Promise<void> {
  try {
    const before = await requireMeeting(store, meetingId);
    if (!before.audioChunks.length) throw new Error('No audio was captured');
    await store.update(meetingId, (item) => { item.processingStage = 'diarizing'; item.status = item.provisionalReport ? 'ready' : 'processing'; item.error = undefined; item.finalError = undefined; });
    const meeting = await requireMeeting(store, meetingId);
    const audioDirectory = join(dataRoot, 'audio');
    const sourceAudioPath = join(audioDirectory, `${meetingId}-source.webm`);
    const chunks = await Promise.all([...meeting.audioChunks].sort((left, right) => chunkSequence(left) - chunkSequence(right)).map((file) => readFile(store.audioFile(file))));
    await writeFile(sourceAudioPath, Buffer.concat(chunks));
    const worker = ai ?? createOpenAiMeetingAi();
    const transcript: TranscriptSegment[] = [];
    let segments: DiarizationAudioSegment[] = [];
    try {
      segments = await segmentAudio(sourceAudioPath, audioDirectory, meetingId);
      await store.update(meetingId, (item) => { item.processingProgress = { completed: 0, total: segments.length }; });
      const diarizedSections = await mapWithConcurrency(segments, 2, async (segment) => {
        const skip = isSilentSegment(await measureVolume(segment.audioPath));
        const result = skip ? {} : await retryTransient(() => worker.diarize(segment.audioPath, meeting.language));
        await store.update(meetingId, (item) => {
          const progress = item.processingProgress ?? { completed: 0, total: segments.length };
          item.processingProgress = { ...progress, completed: Math.min(progress.total, progress.completed + 1) };
        });
        return transcriptFromDiarizedResponse(result, segment.startSeconds, segment.batchIndex);
      });
      transcript.push(...collapseHallucinatedSegmentRepeats(diarizedSections.flat()));
    } finally {
      await Promise.all([rm(sourceAudioPath, { force: true }), ...segments.map((segment) => rm(segment.audioPath, { force: true }))]);
    }
    await reconcileSpeakerLabels(transcript, worker);
    if (!transcript.length) throw new Error('The recording did not contain transcribable speech.');
    const report = parseMeetingReport(await worker.summarize(transcriptAsText(transcript), meeting.userNotes), transcript);
    await store.update(meetingId, (item) => { item.finalTranscript = transcript; item.finalReport = report; item.transcript = transcript; item.report = report; item.status = 'ready'; item.processingStage = 'final_ready'; item.error = undefined; item.finalError = undefined; });
  } catch (error) {
    const message = errorMessage(error);
    await store.update(meetingId, (item) => {
      if (item.provisionalReport) { item.status = 'ready'; item.processingStage = 'initial_ready'; item.finalError = message; }
      else { item.status = 'failed'; item.processingStage = 'failed'; item.error = message; }
    });
  }
}

export async function processMeeting(store: MeetingStore, meetingId: string, dataRoot: string): Promise<void> { await processFinalDiarizedMeeting(store, meetingId, dataRoot); }

// Strict structured outputs: OpenAI guarantees a successful response matches this shape exactly,
// so callers (parseMeetingReport) don't need to re-validate individual fields. Strict mode requires
// every property to be listed in `required` and `additionalProperties: false` on every object —
// optional fields are modeled as nullable rather than omitted.
const MEETING_REPORT_SCHEMA = {
  name: 'meeting_report',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      decisions: { type: 'array', items: { type: 'string' } },
      actionItems: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            ownerSpeakerLabel: { type: ['string', 'null'] },
            dueDate: { type: ['string', 'null'] },
          },
          required: ['text', 'ownerSpeakerLabel', 'dueDate'],
          additionalProperties: false,
        },
      },
      openQuestions: { type: 'array', items: { type: 'string' } },
    },
    required: ['summary', 'decisions', 'actionItems', 'openQuestions'],
    additionalProperties: false,
  },
} as const;
// Strict mode can't express an object with dynamic/unknown keys (the speaker labels vary per
// meeting), so the mapping travels as an array of {from, to} pairs instead of {label: label}.
const SPEAKER_MAPPING_SCHEMA = {
  name: 'speaker_mapping',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      mappings: {
        type: 'array',
        items: {
          type: 'object',
          properties: { from: { type: 'string' }, to: { type: 'string' } },
          required: ['from', 'to'],
          additionalProperties: false,
        },
      },
    },
    required: ['mappings'],
    additionalProperties: false,
  },
} as const;

function createOpenAiMeetingAi(): MeetingAi {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return {
    diarize: async (audioPath, language) => openai.audio.transcriptions.create({ file: createReadStream(audioPath), model: 'gpt-4o-transcribe-diarize', response_format: 'diarized_json', chunking_strategy: 'auto', ...(openAiLanguageCode(language) ? { language: openAiLanguageCode(language) } : {}) } as never) as unknown as Promise<{ text?: string; segments?: { speaker?: string; start?: number; end?: number; text?: string }[] }>,
    summarize: async (transcriptText, userNotes) => {
      const systemPrompt = userNotes?.trim()
        ? 'Create an accurate English meeting report from the transcript and the attendee scratchpad notes. Give strong priority to topics, decisions, and action items noted in the attendee notes, cross-referencing against the spoken transcript. Do not invent decisions, owners, or due dates; use null for an unknown owner or due date.'
        : 'Create an accurate English meeting report from the transcript. Do not invent decisions, owners, or due dates; use null for an unknown owner or due date.';
      const userContent = userNotes?.trim()
        ? `Attendee scratchpad notes:\n${userNotes.trim()}\n\nTranscript:\n${transcriptText}`
        : transcriptText;
      const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_SUMMARY_MODEL ?? 'gpt-4.1-mini',
        response_format: { type: 'json_schema', json_schema: MEETING_REPORT_SCHEMA },
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
      });
      return completion.choices[0]?.message.content;
    },
    reconcileSpeakers: async (transcriptText, speakerLabels) => {
      const completion = await openai.chat.completions.create({ model: process.env.OPENAI_SUMMARY_MODEL ?? 'gpt-4.1-mini', response_format: { type: 'json_schema', json_schema: SPEAKER_MAPPING_SCHEMA }, messages: [{ role: 'system', content: `This transcript was diarized in separate chunks, so the same real speaker may appear under multiple different speaker labels (labels from later chunks carry a numeric prefix, e.g. "Speaker 2-A"). Using topic continuity, phrasing, and who is replying to whom, work out which labels refer to the same real person. The known speaker labels are: ${speakerLabels.join(', ')}. Return one {from, to} pair for every one of the known labels, where "to" is the canonical label to merge it into. Each "to" value must be reused verbatim from the known speaker labels above — never invent a new label.` }, { role: 'user', content: transcriptText }] });
      const content = completion.choices[0]?.message.content;
      if (!content?.trim()) return undefined;
      try {
        const parsed = JSON.parse(content) as { mappings?: unknown };
        return mappingsToRecord(Array.isArray(parsed.mappings) ? parsed.mappings as { from?: unknown; to?: unknown }[] : undefined);
      } catch { return undefined; }
    },
    transcribe: async (audioPath, language) => {
      const prompt = transcriptionPrompt(language, openAiVocabulary());
      const result = await openai.audio.transcriptions.create({
        file: createReadStream(audioPath),
        model: 'gpt-transcribe',
        ...(openAiLanguageCode(language) ? { language: openAiLanguageCode(language) } : {}),
        ...(prompt ? { prompt } : {}),
      } as never) as unknown as { text?: string };
      return result.text ?? '';
    },
  };
}

async function rebuildProvisionalTranscript(store: MeetingStore, meeting: MeetingRecord, dataRoot: string, transcribe: (audioPath: string, language: MeetingLanguage) => Promise<string>, segmentAudio: DiarizationSegmenter, measureVolume: VolumeMeasurer): Promise<TranscriptSegment[]> {
  const audioDirectory = join(dataRoot, 'audio');
  const sourceAudioPath = join(audioDirectory, `${meeting.id}-initial-source.webm`);
  const chunks = await Promise.all([...meeting.audioChunks].sort((left, right) => chunkSequence(left) - chunkSequence(right)).map((file) => readFile(store.audioFile(file))));
  await writeFile(sourceAudioPath, Buffer.concat(chunks));
  let segments: DiarizationAudioSegment[] = [];
  try {
    segments = await segmentAudio(sourceAudioPath, audioDirectory, meeting.id);
    const text = await mapWithConcurrency(segments, 2, async (segment) => {
      if (isSilentSegment(await measureVolume(segment.audioPath))) return '';
      return collapseHallucinatedRepetition((await transcribe(segment.audioPath, meeting.language)).trim());
    });
    return segments.flatMap((segment, index) => text[index] ? [{ speakerLabel: 'Speaker pending', startSeconds: segment.startSeconds, endSeconds: segment.startSeconds + 600, text: text[index] }] : []);
  } finally {
    await Promise.all([rm(sourceAudioPath, { force: true }), ...segments.map((segment) => rm(segment.audioPath, { force: true }))]);
  }
}

function transcriptFromDiarizedResponse(transcription: { text?: string; segments?: { speaker?: string; start?: number; end?: number; text?: string }[] }, offsetSeconds: number, batchIndex: number): TranscriptSegment[] {
  const speakerPrefix = batchIndex ? `${batchIndex + 1}-` : '';
  const transcript = (transcription.segments ?? [])
    .map((segment, index) => ({ speakerLabel: `Speaker ${speakerPrefix}${segment.speaker ?? String.fromCharCode(65 + index % 26)}`, startSeconds: offsetSeconds + (segment.start ?? 0), endSeconds: offsetSeconds + (segment.end ?? 0), text: collapseHallucinatedRepetition(segment.text ?? '') }))
    .filter((segment) => segment.text);
  if (!transcript.length && transcription.text?.trim()) transcript.push({ speakerLabel: `Speaker ${speakerPrefix}A`, startSeconds: offsetSeconds, endSeconds: offsetSeconds, text: collapseHallucinatedRepetition(transcription.text.trim()) });
  return transcript;
}
// Best-effort: OpenAI's diarization labels ("A", "B", ...) only carry meaning within a single chunk-level API
// call, so the same real speaker can surface under several distinct labels across chunks. This reconciles those
// chunk-fragmented labels into one canonical label per real person before stats/report generation, without ever
// turning an otherwise-successful diarization into a failed meeting.
async function reconcileSpeakerLabels(transcript: TranscriptSegment[], worker: MeetingAi): Promise<void> {
  if (!transcript.length || !worker.reconcileSpeakers) return;
  const knownLabels = [...new Set(transcript.map((segment) => segment.speakerLabel))].sort();
  if (knownLabels.length <= 1) return;
  try {
    const mapping = await worker.reconcileSpeakers(transcriptAsText(transcript), knownLabels);
    applySpeakerReconciliation(transcript, mapping, knownLabels);
  } catch (error) {
    // Reconciliation is a best-effort enhancement layered on top of already-successful diarization; leave the
    // original, unmerged labels in place if it throws or returns something unusable. Still log it — a silently
    // failing reconciliation looks identical to "these really are different speakers" otherwise.
    console.error('Speaker reconciliation failed; keeping unmerged chunk-level labels.', error);
  }
}
function applySpeakerReconciliation(transcript: TranscriptSegment[], mapping: Record<string, string> | null | undefined, knownLabels: string[]): void {
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) return;
  const knownLabelSet = new Set(knownLabels);
  const validMapping = new Map<string, string>();
  for (const [originalLabel, mappedLabel] of Object.entries(mapping)) {
    if (typeof mappedLabel === 'string' && knownLabelSet.has(mappedLabel)) validMapping.set(originalLabel, mappedLabel);
  }
  for (const segment of transcript) {
    const mappedLabel = validMapping.get(segment.speakerLabel);
    if (mappedLabel) segment.speakerLabel = mappedLabel;
  }
}
async function segmentDiarizationAudio(sourceAudioPath: string, audioDirectory: string, meetingId: string): Promise<DiarizationAudioSegment[]> {
  return segmentAudioFile(sourceAudioPath, audioDirectory, meetingId, 'diarization', 1200);
}
async function segmentFastTranscriptionAudio(sourceAudioPath: string, audioDirectory: string, meetingId: string): Promise<DiarizationAudioSegment[]> {
  return segmentAudioFile(sourceAudioPath, audioDirectory, meetingId, 'initial', 600);
}
async function segmentAudioFile(sourceAudioPath: string, audioDirectory: string, meetingId: string, purpose: string, seconds: number): Promise<DiarizationAudioSegment[]> {
  const outputPattern = join(audioDirectory, `${meetingId}-${purpose}-%03d.webm`);
  await runFfmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-i', sourceAudioPath, '-map', '0:a', '-c:a', 'copy', '-f', 'segment', '-segment_time', String(seconds), '-reset_timestamps', '1', outputPattern]);
  const files = (await readdir(audioDirectory)).filter((file) => new RegExp(`^${meetingId}-${purpose}-\\d{3}\\.webm$`).test(file)).sort();
  if (!files.length) throw new Error('Could not prepare the recording for speaker analysis.');
  return files.map((file, batchIndex) => ({ audioPath: join(audioDirectory, file), batchIndex, startSeconds: batchIndex * seconds }));
}
async function runFfmpeg(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const process = spawn('ffmpeg', args, { windowsHide: true });
    let errorOutput = '';
    process.stderr.on('data', (chunk: Buffer) => { errorOutput += chunk.toString(); });
    process.once('error', () => reject(new Error('FFmpeg is required to prepare the speaker report. Install FFmpeg, then retry this meeting.')));
    process.once('close', (code) => code === 0 ? resolve() : reject(new Error(errorOutput.trim() || 'Could not prepare the recording for speaker analysis.')));
  });
}

export async function checkFfmpegAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const process = spawn('ffmpeg', ['-version'], { windowsHide: true, timeout: 3000 });
    process.once('error', () => resolve(false));
    process.once('close', (code) => resolve(code === 0));
  });
}
export function chunkSequence(file: string): number { return Number(file.match(/-(\d+)\.webm$/i)?.[1] ?? 0); }
async function mapWithConcurrency<T, R>(values: T[], concurrency: number, transform: (value: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (next < values.length) { const index = next++; results[index] = await transform(values[index]); }
  }));
  return results;
}
function transcriptAsText(transcript: TranscriptSegment[]): string { return transcript.map((segment) => `${segment.speakerLabel} [${formatTime(segment.startSeconds)}]: ${segment.text}`).join('\n'); }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'Processing failed'; }
async function requireMeeting(store: MeetingStore, meetingId: string): Promise<MeetingRecord> { const meeting = await store.get(meetingId); if (!meeting) throw new Error('Meeting not found'); return meeting; }
function formatTime(seconds: number): string { return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`; }
