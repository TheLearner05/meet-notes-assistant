import type { MeetingLanguage, MeetingStore } from './meeting-store.js';
import { collapseHallucinatedRepetition } from './transcription-quality.js';

export type ChunkTranscriber = (audioPath: string, language: MeetingLanguage) => Promise<string>;

type Job = {
  meetingId: string;
  sequence: number;
  audioPath: string;
  language: MeetingLanguage;
  resolve: () => void;
};

export class ProvisionalTranscriptionQueue {
  private readonly jobs: Job[] = [];
  private readonly pendingByMeeting = new Map<string, Set<Promise<void>>>();
  private active = 0;

  constructor(private readonly store: MeetingStore, private readonly transcribe: ChunkTranscriber, private readonly concurrency = 2) {}

  enqueue(meetingId: string, sequence: number, audioPath: string, language: MeetingLanguage): Promise<void> {
    let resolve!: () => void;
    const completion = new Promise<void>((done) => { resolve = done; });
    const pending = this.pendingByMeeting.get(meetingId) ?? new Set<Promise<void>>();
    pending.add(completion);
    this.pendingByMeeting.set(meetingId, pending);
    void completion.then(() => {
      pending.delete(completion);
      if (!pending.size) this.pendingByMeeting.delete(meetingId);
    });
    this.jobs.push({ meetingId, sequence, audioPath, language, resolve });
    this.pump();
    return completion;
  }

  async flush(meetingId: string): Promise<void> {
    while (this.pendingByMeeting.get(meetingId)?.size) {
      await Promise.all([...this.pendingByMeeting.get(meetingId)!]);
    }
  }

  private pump(): void {
    while (this.active < this.concurrency && this.jobs.length) {
      const job = this.jobs.shift()!;
      this.active += 1;
      void this.execute(job);
    }
  }

  private async execute(job: Job): Promise<void> {
    try {
      await this.store.update(job.meetingId, (meeting) => { if (meeting.processingStage === 'recording') meeting.processingStage = 'transcribing_fast'; });
      const text = collapseHallucinatedRepetition((await this.transcribe(job.audioPath, job.language)).trim());
      if (text) {
        await this.store.update(job.meetingId, (meeting) => {
          meeting.provisionalTranscript = [
            ...meeting.provisionalTranscript.filter((segment) => segment.startSeconds !== job.sequence * 30),
            { speakerLabel: 'Speaker pending', startSeconds: job.sequence * 30, endSeconds: (job.sequence + 1) * 30, text },
          ].sort((left, right) => left.startSeconds - right.startSeconds);
          meeting.provisionalError = undefined;
        });
      }
    } catch (error) {
      await this.store.update(job.meetingId, (meeting) => {
        meeting.provisionalError = error instanceof Error ? error.message : 'A live transcript chunk could not be processed';
      });
    } finally {
      job.resolve();
      this.active -= 1;
      this.pump();
    }
  }
}
