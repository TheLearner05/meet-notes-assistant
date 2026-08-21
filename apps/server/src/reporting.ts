import { createReadStream } from 'node:fs';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import OpenAI from 'openai';
import type { MeetingLanguage, MeetingRecord, MeetingReport, MeetingStore, TranscriptSegment } from './meeting-store.js';
import { retryTransient } from './processing-retry.js';
import { openAiLanguageHints, openAiVocabulary } from './transcription-config.js';

export type MeetingAi = {
  diarize: (audioPath: string, language: MeetingLanguage) => Promise<{ text?: string; segments?: { speaker?: string; start?: number; end?: number; text?: string }[] }>;
  summarize: (transcriptText: string) => Promise<string | null | undefined>;
  transcribe?: (audioPath: string, language: MeetingLanguage) => Promise<string>;
};
export type DiarizationAudioSegment = { audioPath: string; batchIndex: number; startSeconds: number };
export type DiarizationSegmenter = (sourceAudioPath: string, audioDirectory: string, meetingId: string) => Promise<DiarizationAudioSegment[]>;
export type ProvisionalProcessingOptions = { dataRoot?: string; transcribe?: (audioPath: string, language: MeetingLanguage) => Promise<string>; segmentAudio?: DiarizationSegmenter };

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

export function parseMeetingReport(content: string | null | undefined, transcript: TranscriptSegment[]): MeetingReport {
  const fallback: MeetingReport = { summary: 'The transcript was saved, but an AI summary was unavailable.', decisions: [], actionItems: [], openQuestions: [], speakerStats: calculateSpeakerStats(transcript) };
  if (!content?.trim()) return fallback;
  try {
    const parsed = JSON.parse(content) as Partial<Omit<MeetingReport, 'speakerStats'>>;
    return {
      summary: typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary : fallback.summary,
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions.filter((item): item is string => typeof item === 'string') : [],
      actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems.filter((item): item is MeetingReport['actionItems'][number] => Boolean(item) && typeof item === 'object' && typeof item.text === 'string') : [],
      openQuestions: Array.isArray(parsed.openQuestions) ? parsed.openQuestions.filter((item): item is string => typeof item === 'string') : [],
      speakerStats: fallback.speakerStats,
    };
  } catch { return fallback; }
}

export function reportAsMarkdown(meeting: MeetingRecord): string {
  const report = meeting.finalReport ?? meeting.provisionalReport ?? meeting.report;
  const transcript = meeting.finalTranscript.length ? meeting.finalTranscript : meeting.provisionalTranscript.length ? meeting.provisionalTranscript : meeting.transcript;
  const isInitial = !meeting.finalReport && Boolean(meeting.provisionalReport);
  if (!report) return '# Meeting report\n\nThe report is not ready yet.';
  const actions = report.actionItems.map((item) => `- ${item.text}${item.ownerSpeakerLabel ? ` — ${item.ownerSpeakerLabel}` : ''}${item.dueDate ? ` (due ${item.dueDate})` : ''}`).join('\n') || '- None stated';
  const formattedTranscript = transcript.map((item) => `**${item.speakerLabel}** [${formatTranscriptDateTime(meeting.createdAt, item.startSeconds)}] ${item.text}`).join('\n\n');
  return `# Meeting report\n\n${isInitial ? '## Initial notes — speaker attribution pending\n\n' : ''}## Summary\n${report.summary}\n\n## Decisions\n${report.decisions.map((item) => `- ${item}`).join('\n') || '- None stated'}\n\n## Action items\n${actions}\n\n## Open questions\n${report.openQuestions.map((item) => `- ${item}`).join('\n') || '- None stated'}\n\n## Speaker report\n${report.speakerStats.map((item) => `- ${item.speakerLabel}: ${Math.round(item.talkSeconds)} seconds`).join('\n')}\n\n## Transcript\n${formattedTranscript}`;
}

export async function processProvisionalMeeting(store: MeetingStore, meetingId: string, flushChunks: (meetingId: string) => Promise<void>, summarize?: (transcriptText: string) => Promise<string | null | undefined>, options: ProvisionalProcessingOptions = {}): Promise<void> {
  try {
    await store.update(meetingId, (item) => { item.status = 'processing'; item.processingStage = 'transcribing_fast'; item.error = undefined; item.provisionalError = undefined; });
    await flushChunks(meetingId);
    const meeting = await requireMeeting(store, meetingId);
    let transcript = meeting.provisionalTranscript;
    if (options.dataRoot && transcript.length < meeting.audioChunks.length) {
      transcript = await rebuildProvisionalTranscript(store, meeting, options.dataRoot, options.transcribe ?? createOpenAiMeetingAi().transcribe!, options.segmentAudio ?? segmentFastTranscriptionAudio);
      await store.update(meetingId, (item) => { item.provisionalTranscript = transcript; });
    }
    if (!transcript.length) throw new Error('The recording did not contain transcribable speech.');
    const report = parseMeetingReport(await (summarize ?? createOpenAiMeetingAi().summarize)(transcriptAsText(transcript)), transcript);
    await store.update(meetingId, (item) => { item.provisionalReport = report; item.report = report; item.transcript = transcript; item.status = 'ready'; item.processingStage = 'initial_ready'; item.error = undefined; });
  } catch (error) {
    await store.update(meetingId, (item) => { item.status = 'failed'; item.processingStage = 'failed'; item.error = errorMessage(error); item.provisionalError = item.error; });
  }
}

export async function processFinalDiarizedMeeting(store: MeetingStore, meetingId: string, dataRoot: string, ai?: MeetingAi, segmentAudio: DiarizationSegmenter = segmentDiarizationAudio): Promise<void> {
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
        const result = await retryTransient(() => worker.diarize(segment.audioPath, meeting.language));
        await store.update(meetingId, (item) => {
          const progress = item.processingProgress ?? { completed: 0, total: segments.length };
          item.processingProgress = { ...progress, completed: Math.min(progress.total, progress.completed + 1) };
        });
        return transcriptFromDiarizedResponse(result, segment.startSeconds, segment.batchIndex);
      });
      transcript.push(...diarizedSections.flat());
    } finally {
      await Promise.all([rm(sourceAudioPath, { force: true }), ...segments.map((segment) => rm(segment.audioPath, { force: true }))]);
    }
    if (!transcript.length) throw new Error('The recording did not contain transcribable speech.');
    const report = parseMeetingReport(await worker.summarize(transcriptAsText(transcript)), transcript);
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

function createOpenAiMeetingAi(): MeetingAi {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return {
    diarize: async (audioPath, language) => openai.audio.transcriptions.create({ file: createReadStream(audioPath), model: 'gpt-4o-transcribe-diarize', response_format: 'diarized_json', chunking_strategy: 'auto', ...(language === 'en' ? { language: 'en' } : {}) } as never) as unknown as Promise<{ text?: string; segments?: { speaker?: string; start?: number; end?: number; text?: string }[] }>,
    summarize: async (transcriptText) => {
      const completion = await openai.chat.completions.create({ model: process.env.OPENAI_SUMMARY_MODEL ?? 'gpt-4.1-mini', response_format: { type: 'json_object' }, messages: [{ role: 'system', content: 'Create an accurate English meeting report from the transcript. Return JSON with summary (string), decisions (string[]), actionItems ({text, ownerSpeakerLabel?, dueDate?}[]), and openQuestions (string[]). Do not invent decisions, owners, or due dates; use null for unknown due dates.' }, { role: 'user', content: transcriptText }] });
      return completion.choices[0]?.message.content;
    },
    transcribe: async (audioPath, language) => {
      const result = await openai.audio.transcriptions.create({ file: createReadStream(audioPath), model: 'gpt-transcribe', languages: openAiLanguageHints(language), keywords: openAiVocabulary() } as never) as unknown as { text?: string };
      return result.text ?? '';
    },
  };
}

async function rebuildProvisionalTranscript(store: MeetingStore, meeting: MeetingRecord, dataRoot: string, transcribe: (audioPath: string, language: MeetingLanguage) => Promise<string>, segmentAudio: DiarizationSegmenter): Promise<TranscriptSegment[]> {
  const audioDirectory = join(dataRoot, 'audio');
  const sourceAudioPath = join(audioDirectory, `${meeting.id}-initial-source.webm`);
  const chunks = await Promise.all([...meeting.audioChunks].sort((left, right) => chunkSequence(left) - chunkSequence(right)).map((file) => readFile(store.audioFile(file))));
  await writeFile(sourceAudioPath, Buffer.concat(chunks));
  let segments: DiarizationAudioSegment[] = [];
  try {
    segments = await segmentAudio(sourceAudioPath, audioDirectory, meeting.id);
    const text = await mapWithConcurrency(segments, 2, async (segment) => (await transcribe(segment.audioPath, meeting.language)).trim());
    return segments.flatMap((segment, index) => text[index] ? [{ speakerLabel: 'Speaker pending', startSeconds: segment.startSeconds, endSeconds: segment.startSeconds + 600, text: text[index] }] : []);
  } finally {
    await Promise.all([rm(sourceAudioPath, { force: true }), ...segments.map((segment) => rm(segment.audioPath, { force: true }))]);
  }
}

function transcriptFromDiarizedResponse(transcription: { text?: string; segments?: { speaker?: string; start?: number; end?: number; text?: string }[] }, offsetSeconds: number, batchIndex: number): TranscriptSegment[] {
  const speakerPrefix = batchIndex ? `${batchIndex + 1}-` : '';
  const transcript = (transcription.segments ?? []).map((segment, index) => ({ speakerLabel: `Speaker ${speakerPrefix}${segment.speaker ?? String.fromCharCode(65 + index % 26)}`, startSeconds: offsetSeconds + (segment.start ?? 0), endSeconds: offsetSeconds + (segment.end ?? 0), text: segment.text ?? '' }));
  if (!transcript.length && transcription.text?.trim()) transcript.push({ speakerLabel: `Speaker ${speakerPrefix}A`, startSeconds: offsetSeconds, endSeconds: offsetSeconds, text: transcription.text.trim() });
  return transcript;
}
async function segmentDiarizationAudio(sourceAudioPath: string, audioDirectory: string, meetingId: string): Promise<DiarizationAudioSegment[]> {
  return segmentAudioFile(sourceAudioPath, audioDirectory, meetingId, 'diarization', 600);
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
    process.once('error', () => reject(new Error('FFmpeg is required to prepare longer recordings. Install FFmpeg, then retry this meeting.')));
    process.once('close', (code) => code === 0 ? resolve() : reject(new Error(errorOutput.trim() || 'Could not prepare the recording for speaker analysis.')));
  });
}
function chunkSequence(file: string): number { return Number(file.match(/-(\d+)\.webm$/i)?.[1] ?? 0); }
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
