import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export type MeetingLanguage = 'hi-en' | 'mr-en' | 'en' | 'auto';
export type MeetingStatus = 'recording' | 'processing' | 'ready' | 'failed' | 'deleted';
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
  createdAt: string;
  endedAt?: string;
  rawAudioDeleteAfter: string;
  audioChunks: string[];
  transcript: TranscriptSegment[];
  report?: MeetingReport;
  googleDocUrl?: string;
  error?: string;
};

export function createMeetingRecord(language: MeetingLanguage, now = new Date()): MeetingRecord {
  return {
    id: randomUUID(),
    source: 'google-meet',
    language,
    status: 'recording',
    createdAt: now.toISOString(),
    rawAudioDeleteAfter: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    audioChunks: [],
    transcript: [],
  };
}

export class MeetingStore {
  private readonly databasePath: string;
  private readonly audioPath: string;

  constructor(private readonly rootPath: string) {
    this.databasePath = join(rootPath, 'meetings.json');
    this.audioPath = join(rootPath, 'audio');
  }

  async init(): Promise<void> {
    await mkdir(this.audioPath, { recursive: true });
    try { await readFile(this.databasePath, 'utf8'); } catch { await this.save([]); }
  }

  async create(language: MeetingLanguage): Promise<MeetingRecord> {
    const meetings = await this.load();
    const meeting = createMeetingRecord(language);
    meetings.unshift(meeting);
    await this.save(meetings);
    return meeting;
  }

  async list(query = ''): Promise<MeetingRecord[]> {
    const normalized = query.trim().toLowerCase();
    return (await this.load()).filter((meeting) => meeting.status !== 'deleted' && (!normalized || JSON.stringify(meeting).toLowerCase().includes(normalized)));
  }

  async get(id: string): Promise<MeetingRecord | undefined> {
    return (await this.load()).find((meeting) => meeting.id === id && meeting.status !== 'deleted');
  }

  async update(id: string, mutate: (meeting: MeetingRecord) => void): Promise<MeetingRecord> {
    const meetings = await this.load();
    const meeting = meetings.find((item) => item.id === id && item.status !== 'deleted');
    if (!meeting) throw new Error('Meeting not found');
    mutate(meeting);
    await this.save(meetings);
    return meeting;
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

  private async load(): Promise<MeetingRecord[]> { return JSON.parse(await readFile(this.databasePath, 'utf8')) as MeetingRecord[]; }
  private async save(meetings: MeetingRecord[]): Promise<void> { await writeFile(this.databasePath, JSON.stringify(meetings, null, 2)); }
}
