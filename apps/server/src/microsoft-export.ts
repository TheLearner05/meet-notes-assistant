import OpenAI from 'openai';
import type { MeetingRecord, MeetingStore } from './meeting-store.js';
import { acquireGraphAccessToken, hasMicrosoftConnection, microsoftConfigured } from './microsoft-graph.js';
import { buildWordDocumentBuffer, uploadRunningDocument } from './microsoft-word-export.js';
import { applyTaskOperations, readOpenTaskRows } from './microsoft-excel-export.js';
import { buildTaskMatchMessages, parseTaskMatchResponse, type OpenTaskRow } from './microsoft-task-matcher.js';

export function isExportReady(meeting: Pick<MeetingRecord, 'processingStage' | 'finalError'>): boolean {
  return meeting.processingStage === 'final_ready' || (meeting.processingStage === 'initial_ready' && Boolean(meeting.finalError));
}

function meetingTitle(meeting: MeetingRecord): string {
  return meeting.title ? `${meeting.title} — ${new Date(meeting.createdAt).toLocaleString()}` : `Meeting — ${new Date(meeting.createdAt).toLocaleString()}`;
}

async function matchTasksWithAi(meeting: MeetingRecord, openTasks: OpenTaskRow[]) {
  const report = meeting.finalReport ?? meeting.provisionalReport ?? meeting.report;
  if (!report?.actionItems.length) return [];
  if (!process.env.OPENAI_API_KEY) return [];
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_SUMMARY_MODEL ?? 'gpt-4.1-mini',
    response_format: { type: 'json_object' },
    messages: buildTaskMatchMessages(meetingTitle(meeting), report.actionItems, openTasks),
  });
  return parseTaskMatchResponse(completion.choices[0]?.message.content, openTasks);
}

export async function exportToMicrosoft365(store: MeetingStore, meetingId: string, dataRoot: string): Promise<void> {
  if (!microsoftConfigured()) return;
  const meeting = await store.get(meetingId);
  if (!meeting || !isExportReady(meeting)) return;
  // No token file yet means the user has never connected Microsoft 365 — skip quietly rather than
  // reporting an error, the same way the Google Docs export button stays inert until connected.
  if (!(await hasMicrosoftConnection(dataRoot))) return;

  let accessToken: string;
  try { accessToken = await acquireGraphAccessToken(dataRoot); }
  catch (error) {
    await store.update(meetingId, (item) => { item.microsoftExportError = error instanceof Error ? error.message : 'Could not access Microsoft 365'; });
    return;
  }

  const wordPath = process.env.MICROSOFT_WORD_PATH ?? '/Meeting Reports/Running Report.docx';
  try {
    const buffer = await buildWordDocumentBuffer(await store.list());
    await uploadRunningDocument(accessToken, wordPath, buffer);
    await store.update(meetingId, (item) => { item.microsoftExportError = undefined; });
  } catch (error) {
    await store.update(meetingId, (item) => { item.microsoftExportError = error instanceof Error ? error.message : 'Word export failed'; });
  }

  if (meeting.microsoftTasksExported) return;
  const excelPath = process.env.MICROSOFT_EXCEL_PATH ?? '/Meeting Reports/Tasks.xlsx';
  try {
    const { workbook, openTasks } = await readOpenTaskRows(accessToken, excelPath);
    const operations = await matchTasksWithAi(meeting, openTasks);
    if (operations.length) await applyTaskOperations(accessToken, excelPath, workbook, meetingTitle(meeting), operations);
    await store.update(meetingId, (item) => { item.microsoftTasksExported = true; item.microsoftExportError = undefined; });
  } catch (error) {
    await store.update(meetingId, (item) => { item.microsoftExportError = error instanceof Error ? error.message : 'Excel export failed'; });
  }
}
