import { Document, Packer, Paragraph } from 'docx';
import type { MeetingRecord } from './meeting-store.js';
import { graphItemUrl, graphRequest } from './microsoft-graph.js';

export function selectRunningDocumentMeetings(meetings: MeetingRecord[]): MeetingRecord[] {
  return meetings
    .filter((meeting) => meeting.status === 'ready' && (meeting.finalReport ?? meeting.provisionalReport ?? meeting.report))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export function buildRunningDocumentText(meetings: MeetingRecord[]): string {
  const sections = selectRunningDocumentMeetings(meetings).map((meeting) => {
    const report = (meeting.finalReport ?? meeting.provisionalReport ?? meeting.report)!;
    const transcript = meeting.finalTranscript.length ? meeting.finalTranscript : meeting.provisionalTranscript.length ? meeting.provisionalTranscript : meeting.transcript;
    const decisions = report.decisions.map((item) => `• ${item}`).join('\n') || '• None stated';
    const actions = report.actionItems.map((item) => `• ${item.text}${item.ownerSpeakerLabel ? ` — ${item.ownerSpeakerLabel}` : ''}${item.dueDate ? ` (due ${item.dueDate})` : ''}`).join('\n') || '• None stated';
    const speakerReport = report.speakerStats.map((item) => `• ${item.speakerLabel}: ${Math.round(item.talkSeconds)} seconds`).join('\n');
    const transcriptText = transcript.map((item) => `${item.speakerLabel}: ${item.text}`).join('\n');
    return `Meeting report — ${new Date(meeting.createdAt).toLocaleString()}\n\nSummary\n${report.summary}\n\nDecisions\n${decisions}\n\nAction items\n${actions}\n\nSpeaker report\n${speakerReport}\n\nTranscript\n${transcriptText}`;
  });
  return sections.join(`\n\n${'='.repeat(60)}\n\n`);
}

export async function buildWordDocumentBuffer(meetings: MeetingRecord[]): Promise<Buffer> {
  const text = buildRunningDocumentText(meetings) || 'No meetings have finished processing yet.';
  const document = new Document({ sections: [{ children: text.split('\n').map((line) => new Paragraph(line)) }] });
  return Buffer.from(await Packer.toBuffer(document));
}

export async function uploadRunningDocument(accessToken: string, path: string, buffer: Buffer): Promise<void> {
  // Graph's simple content-upload endpoint only accepts files under 4MB; a running meeting-notes
  // document could eventually exceed that after many months of meetings, at which point this needs
  // an upload session instead of a single PUT.
  await graphRequest(accessToken, graphItemUrl(path, '/content'), {
    method: 'PUT',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    body: new Uint8Array(buffer),
  });
}
