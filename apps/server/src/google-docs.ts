import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { google } from 'googleapis';
import type { MeetingRecord } from './meeting-store.js';

const scopes = ['https://www.googleapis.com/auth/documents'];

export function buildGoogleDocText(meeting: MeetingRecord): string {
  const report = meeting.report;
  if (!report) throw new Error('Meeting report is not ready');
  const transcript = meeting.transcript.map((item) => `${item.speakerLabel} [${Math.floor(item.startSeconds / 60).toString().padStart(2, '0')}:${Math.floor(item.startSeconds % 60).toString().padStart(2, '0')}] ${item.text}`).join('\n\n');
  return `Meeting Report\n${new Date(meeting.createdAt).toLocaleString()}\n\nSummary\n${report.summary}\n\nDecisions\n${report.decisions.map((item) => `• ${item}`).join('\n') || '• None stated'}\n\nAction items\n${report.actionItems.map((item) => `• ${item.text}${item.ownerSpeakerLabel ? ` — ${item.ownerSpeakerLabel}` : ''}${item.dueDate ? ` (due ${item.dueDate})` : ''}`).join('\n') || '• None stated'}\n\nOpen questions\n${report.openQuestions.map((item) => `• ${item}`).join('\n') || '• None stated'}\n\nSpeaker report\n${report.speakerStats.map((item) => `• ${item.speakerLabel}: ${Math.round(item.talkSeconds)} seconds`).join('\n')}\n\nTranscript\n${transcript}`;
}

export function googleConfigured(): boolean { return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET); }
function tokenPath(dataRoot: string): string { return join(dataRoot, 'google-token.json'); }
function client(): InstanceType<typeof google.auth.OAuth2> {
  return new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:8787/api/google/callback');
}

export function googleAuthorizationUrl(): string {
  if (!googleConfigured()) throw new Error('Google OAuth is not configured');
  return client().generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: scopes });
}

export async function saveGoogleCode(dataRoot: string, code: string): Promise<void> {
  const auth = client();
  const { tokens } = await auth.getToken(code);
  await writeFile(tokenPath(dataRoot), JSON.stringify(tokens));
}

async function authorizedClient(dataRoot: string): Promise<InstanceType<typeof google.auth.OAuth2>> {
  const auth = client();
  try { auth.setCredentials(JSON.parse(await readFile(tokenPath(dataRoot), 'utf8'))); } catch { throw new Error('Connect Google Docs first'); }
  return auth;
}

export async function exportMeetingToGoogleDoc(dataRoot: string, meeting: MeetingRecord, destination: { mode: 'new' } | { mode: 'append'; documentId: string }): Promise<{ documentId: string; url: string }> {
  const auth = await authorizedClient(dataRoot);
  const docs = google.docs({ version: 'v1', auth });
  const documentId = destination.mode === 'new' ? (await docs.documents.create({ requestBody: { title: `Meeting report — ${new Date(meeting.createdAt).toLocaleDateString()}` } })).data.documentId : destination.documentId;
  if (!documentId) throw new Error('Google Docs did not return a document ID');
  await docs.documents.batchUpdate({ documentId, requestBody: { requests: [{ insertText: { endOfSegmentLocation: {}, text: `${destination.mode === 'append' ? '\n\n' : ''}${buildGoogleDocText(meeting)}\n` } }] } });
  return { documentId, url: `https://docs.google.com/document/d/${documentId}/edit` };
}
