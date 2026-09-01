import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export type MeetingLanguage = 'hi-en' | 'mr-en' | 'en' | 'auto';
export type MeetingStatus = 'recording' | 'processing' | 'ready' | 'failed' | 'deleted';
export type MeetingProcessingStage = 'recording' | 'transcribing_fast' | 'initial_ready' | 'diarizing' | 'final_ready' | 'failed';
export type MeetingProcessingProgress = { completed: number; total: number; retrying?: number };
export type TranscriptSegment = { speakerLabel: string; startSeconds: number; endSeconds: number; text: string };
export type MeetingReport = {
  summary: string;
  decisions: string[];
  actionItems: { text: string; ownerSpeakerLabel?: string; dueDate?: string | null }[];
  openQuestions: string[];
  speakerStats: { speakerLabel: string; talkSeconds: number }[];
};

export type MeetingRecord = {
  id: string;
  source: 'google-meet';
  language: MeetingLanguage;
  status: MeetingStatus;
  processingStage: MeetingProcessingStage;
  processingProgress?: MeetingProcessingProgress;
  createdAt: string;
  updatedAt: string;
  endedAt?: string;
  rawAudioDeleteAfter: string;
  audioChunks: string[];
  transcript: TranscriptSegment[];
  report?: MeetingReport;
  provisionalTranscript: TranscriptSegment[];
  provisionalReport?: MeetingReport;
  provisionalError?: string;
  finalTranscript: TranscriptSegment[];
  finalReport?: MeetingReport;
  finalError?: string;
  googleDocUrl?: string;
  error?: string;
  forcedFinish?: 'manual' | 'stale-sweep';
  microsoftExportError?: string;
  microsoftTasksExported?: boolean;
};

export function createMeetingRecord(language: MeetingLanguage, now = new Date()): MeetingRecord {
  return {
    id: randomUUID(),
    source: 'google-meet',
    language,
    status: 'recording',
    processingStage: 'recording',
    processingProgress: { completed: 0, total: 0 },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    rawAudioDeleteAfter: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    audioChunks: [],
    transcript: [],
    provisionalTranscript: [],
    finalTranscript: [],
  };
}

export const STALE_RECORDING_THRESHOLD_MS = 3 * 60 * 60 * 1000;

export function isStaleRecording(
  meeting: Pick<MeetingRecord, 'status' | 'createdAt'> & { updatedAt?: string },
  now: Date,
  thresholdMs = STALE_RECORDING_THRESHOLD_MS,
): boolean {
  if (meeting.status !== 'recording') return false;
  const lastActivity = new Date(meeting.updatedAt ?? meeting.createdAt);
  return now.getTime() - lastActivity.getTime() > thresholdMs;
}

export class MeetingStore {
  private readonly databasePath: string;
  private readonly audioPath: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly rootPath: string) {
    this.databasePath = join(rootPath, 'meetings.json');
    this.audioPath = join(rootPath, 'audio');
  }

  async init(): Promise<void> {
    await mkdir(this.audioPath, { recursive: true });
    try { await readFile(this.databasePath, 'utf8'); } catch { await this.save([]); }
  }

  async create(language: MeetingLanguage): Promise<MeetingRecord> {
    return this.mutate(async () => {
      const meetings = await this.load();
      const meeting = createMeetingRecord(language);
      meetings.unshift(meeting);
      await this.save(meetings);
      return meeting;
    });
  }

  // Routed through the same lock as writes so a read can never observe a torn/in-progress save.
  async list(query = ''): Promise<MeetingRecord[]> {
    const normalized = query.trim().toLowerCase();
    return this.mutate(async () => (await this.load()).filter((meeting) => meeting.status !== 'deleted' && (!normalized || JSON.stringify(meeting).toLowerCase().includes(normalized))));
  }

  async get(id: string): Promise<MeetingRecord | undefined> {
    return this.mutate(async () => (await this.load()).find((meeting) => meeting.id === id && meeting.status !== 'deleted'));
  }

  async update(id: string, mutate: (meeting: MeetingRecord) => void): Promise<MeetingRecord> {
    return this.mutate(async () => {
      const meetings = await this.load();
      const meeting = meetings.find((item) => item.id === id && item.status !== 'deleted');
      if (!meeting) throw new Error('Meeting not found');
      mutate(meeting);
      meeting.updatedAt = new Date().toISOString();
      await this.save(meetings);
      return meeting;
    });
  }

  async saveChunk(id: string, sequence: string, audio: Buffer): Promise<void> {
    const filename = `${id}-${sequence}.webm`;
    await writeFile(join(this.audioPath, filename), audio);
    await this.update(id, (meeting) => { if (!meeting.audioChunks.includes(filename)) meeting.audioChunks.push(filename); });
  }

  audioFile(filename: string): string { return join(this.audioPath, filename); }

  async destroy(id: string): Promise<void> {
    const meeting = await this.get(id);
    if (!meeting) throw new Error('Meeting not found');
    await Promise.all(meeting.audioChunks.map((file) => rm(this.audioFile(file), { force: true })));
    await this.update(id, (item) => { item.status = 'deleted'; item.transcript = []; item.report = undefined; item.audioChunks = []; });
  }

  async purgeExpiredAudio(now = new Date()): Promise<void> {
    for (const meeting of await this.load()) {
      if (meeting.status === 'ready' && meeting.audioChunks.length && new Date(meeting.rawAudioDeleteAfter) <= now) {
        await Promise.all(meeting.audioChunks.map((file) => rm(this.audioFile(file), { force: true })));
        await this.update(meeting.id, (item) => { item.audioChunks = []; });
      }
    }
  }

  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.writeChain;
    let release!: () => void;
    this.writeChain = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }

  private async load(): Promise<MeetingRecord[]> {
    const meetings = JSON.parse(await readFile(this.databasePath, 'utf8')) as MeetingRecord[];
    return meetings.map((meeting) => this.hydrate(meeting));
  }

  private hydrate(meeting: MeetingRecord): MeetingRecord {
    const processingStage = meeting.processingStage ?? (meeting.status === 'ready' ? 'final_ready' : meeting.status === 'failed' ? 'failed' : meeting.status === 'processing' ? 'diarizing' : 'recording');
    return {
      ...meeting,
      processingStage,
      updatedAt: meeting.updatedAt ?? meeting.createdAt,
      processingProgress: meeting.processingProgress ?? { completed: 0, total: 0 },
      provisionalTranscript: meeting.provisionalTranscript ?? [],
      finalTranscript: meeting.finalTranscript ?? (processingStage === 'final_ready' ? meeting.transcript : []),
      provisionalReport: meeting.provisionalReport,
      finalReport: meeting.finalReport ?? (processingStage === 'final_ready' ? meeting.report : undefined),
    };
  }
  private async save(meetings: MeetingRecord[]): Promise<void> { await writeFile(this.databasePath, JSON.stringify(meetings, null, 2)); }
}
