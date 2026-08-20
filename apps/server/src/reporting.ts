import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import OpenAI from 'openai';
import type { MeetingLanguage, MeetingRecord, MeetingReport, MeetingStore, TranscriptSegment } from './meeting-store.js';

export type MeetingAi = {
  diarize: (audioPath: string, language: MeetingLanguage) => Promise<{ text?: string; segments?: { speaker?: string; start?: number; end?: number; text?: string }[] }>;
  summarize: (transcriptText: string) => Promise<string | null | undefined>;
};

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

export async function processProvisionalMeeting(store: MeetingStore, meetingId: string, flushChunks: (meetingId: string) => Promise<void>, summarize?: (transcriptText: string) => Promise<string | null | undefined>): Promise<void> {
  try {
    await store.update(meetingId, (item) => { item.status = 'processing'; item.processingStage = 'transcribing_fast'; item.error = undefined; item.provisionalError = undefined; });
    await flushChunks(meetingId);
    const meeting = await requireMeeting(store, meetingId);
    if (!meeting.provisionalTranscript.length) throw new Error('The recording did not contain transcribable speech.');
    const report = parseMeetingReport(await (summarize ?? createOpenAiMeetingAi().summarize)(transcriptAsText(meeting.provisionalTranscript)), meeting.provisionalTranscript);
    await store.update(meetingId, (item) => { item.provisionalReport = report; item.report = report; item.transcript = item.provisionalTranscript; item.status = 'ready'; item.processingStage = 'initial_ready'; item.error = undefined; });
  } catch (error) {
    await store.update(meetingId, (item) => { item.status = 'failed'; item.processingStage = 'failed'; item.error = errorMessage(error); item.provisionalError = item.error; });
  }
}

export async function processFinalDiarizedMeeting(store: MeetingStore, meetingId: string, dataRoot: string, ai?: MeetingAi): Promise<void> {
  try {
    const before = await requireMeeting(store, meetingId);
    if (!before.audioChunks.length) throw new Error('No audio was captured');
    await store.update(meetingId, (item) => { item.processingStage = 'diarizing'; item.status = item.provisionalReport ? 'ready' : 'processing'; item.error = undefined; item.finalError = undefined; });
    const meeting = await requireMeeting(store, meetingId);
    const audioPath = join(dataRoot, 'audio', `${meetingId}.webm`);
    const chunks = await Promise.all(meeting.audioChunks.map((file) => readFile(store.audioFile(file))));
    await writeFile(audioPath, Buffer.concat(chunks));
    const worker = ai ?? createOpenAiMeetingAi();
    const transcript = transcriptFromDiarizedResponse(await worker.diarize(audioPath, meeting.language));
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
  };
}

function transcriptFromDiarizedResponse(transcription: { text?: string; segments?: { speaker?: string; start?: number; end?: number; text?: string }[] }): TranscriptSegment[] {
  const transcript = (transcription.segments ?? []).map((segment, index) => ({ speakerLabel: `Speaker ${segment.speaker ?? String.fromCharCode(65 + index % 26)}`, startSeconds: segment.start ?? 0, endSeconds: segment.end ?? 0, text: segment.text ?? '' }));
  if (!transcript.length && transcription.text?.trim()) transcript.push({ speakerLabel: 'Speaker A', startSeconds: 0, endSeconds: 0, text: transcription.text.trim() });
  return transcript;
}
function transcriptAsText(transcript: TranscriptSegment[]): string { return transcript.map((segment) => `${segment.speakerLabel} [${formatTime(segment.startSeconds)}]: ${segment.text}`).join('\n'); }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'Processing failed'; }
async function requireMeeting(store: MeetingStore, meetingId: string): Promise<MeetingRecord> { const meeting = await store.get(meetingId); if (!meeting) throw new Error('Meeting not found'); return meeting; }
function formatTime(seconds: number): string { return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`; }
