import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import OpenAI from 'openai';
import { isStaleRecording, MeetingStore, type MeetingLanguage } from './meeting-store.js';
import { KnownSpeakerStore } from './known-speakers.js';
import { checkFfmpegAvailable, chunkSequence, processFinalDiarizedMeeting, processProvisionalMeeting, reportAsMarkdown } from './reporting.js';
import { ProvisionalTranscriptionQueue } from './provisional-transcription.js';
import { exportMeetingToGoogleDoc, googleAuthorizationUrl, saveGoogleCode } from './google-docs.js';
import { openAiLanguageCode, openAiVocabulary, transcriptionPrompt } from './transcription-config.js';
import { resolveAllowedOrigin } from './cors.js';
import { microsoftAuthorizationUrl, microsoftConfigured, saveMicrosoftCode } from './microsoft-graph.js';
import { exportToMicrosoft365 } from './microsoft-export.js';
import { applyStoredOpenAiKey, saveOpenAiKey } from './openai-key.js';

try { process.loadEnvFile(); } catch { /* no .env file present; rely on already-set environment variables */ }

const port = Number(process.env.PORT ?? 8787);
const dataRoot = resolve(process.env.DATA_DIRECTORY ?? join(process.cwd(), 'data'));
const publicRoot = resolve(join(process.cwd(), 'public'));
const store = new MeetingStore(dataRoot);
const knownSpeakers = new KnownSpeakerStore(dataRoot);
const provisionalQueue = new ProvisionalTranscriptionQueue(store, async (audioPath, language) => {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const languageCode = openAiLanguageCode(language);
  const prompt = transcriptionPrompt(language, openAiVocabulary());
  const result = await openai.audio.transcriptions.create({
    file: createReadStream(audioPath),
    model: 'gpt-transcribe',
    ...(languageCode ? { language: languageCode } : {}),
    ...(prompt ? { prompt } : {}),
  } as never) as unknown as { text?: string };
  return result.text ?? '';
});
await mkdir(dataRoot, { recursive: true });
await applyStoredOpenAiKey(dataRoot);
await store.init();
await knownSpeakers.init();
await store.purgeExpiredAudio();
await sweepStaleRecordings();
setInterval(() => { void store.purgeExpiredAudio(); }, 60 * 60 * 1000).unref();
setInterval(() => { void sweepStaleRecordings(); }, 60 * 60 * 1000).unref();

const server = createServer(async (request, response) => {
  try {
    await handle(request, response);
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : 'Unexpected server error' });
  }
});

server.listen(port, () => console.log(`Meet Notes Assistant is running at http://localhost:${port}`));

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  setCors(request, response);
  if (request.method === 'OPTIONS') { response.writeHead(204).end(); return; }
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const path = url.pathname;

  if (request.method === 'GET' && path === '/api/health') { sendJson(response, 200, { ok: true, openAiConfigured: Boolean(process.env.OPENAI_API_KEY), ffmpegAvailable: await checkFfmpegAvailable(), microsoftConfigured: microsoftConfigured() }); return; }
  if (request.method === 'POST' && path === '/api/settings/openai-key') {
    const body = await readJson<{ apiKey?: string }>(request);
    await saveOpenAiKey(dataRoot, body.apiKey ?? '');
    sendJson(response, 200, { ok: true }); return;
  }
  if (request.method === 'GET' && path === '/api/google/connect') { response.writeHead(302, { Location: googleAuthorizationUrl() }).end(); return; }
  if (request.method === 'GET' && path === '/api/google/callback') {
    const code = url.searchParams.get('code'); if (!code) throw new Error('Google did not provide an authorization code');
    await saveGoogleCode(dataRoot, code); response.writeHead(302, { Location: '/' }).end(); return;
  }
  if (request.method === 'GET' && path === '/api/microsoft/connect') { response.writeHead(302, { Location: await microsoftAuthorizationUrl() }).end(); return; }
  if (request.method === 'GET' && path === '/api/microsoft/callback') {
    const code = url.searchParams.get('code'); if (!code) throw new Error('Microsoft did not provide an authorization code');
    await saveMicrosoftCode(dataRoot, code); response.writeHead(302, { Location: '/' }).end(); return;
  }
  if (request.method === 'GET' && path === '/api/meetings') { sendJson(response, 200, await store.list(url.searchParams.get('q') ?? '')); return; }
  if (request.method === 'GET' && path === '/api/known-speakers') { sendJson(response, 200, await knownSpeakers.list()); return; }
  if (request.method === 'POST' && path === '/api/meetings') {
    const body = await readJson<{ language?: MeetingLanguage; title?: string }>(request);
    const language = ['hi-en', 'mr-en', 'en', 'auto'].includes(body.language ?? '') ? body.language as MeetingLanguage : 'auto';
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : undefined;
    sendJson(response, 201, await store.create(language, title)); return;
  }

  const chunkMatch = path.match(/^\/api\/meetings\/([a-z0-9-]+)\/chunks\/(\d+)$/i);
  if (request.method === 'PUT' && chunkMatch) {
    await store.saveChunk(chunkMatch[1], chunkMatch[2], await readBody(request));
    void provisionalQueue.enqueue(chunkMatch[1], Number(chunkMatch[2]), store.audioFile(`${chunkMatch[1]}-${chunkMatch[2]}.webm`), (await requireMeeting(chunkMatch[1])).language);
    sendJson(response, 200, { ok: true }); return;
  }

  const finishMatch = path.match(/^\/api\/meetings\/([a-z0-9-]+)\/finish$/i);
  if (request.method === 'POST' && finishMatch) {
    const body = await readJson<{ manual?: boolean; userNotes?: string }>(request);
    if (typeof body.userNotes === 'string' && body.userNotes.trim()) {
      await store.update(finishMatch[1], (item) => {
        item.userNotes = body.userNotes!.trim();
      });
    }
    const meeting = await queueProcessing(finishMatch[1], body.manual ? 'manual' : undefined);
    sendJson(response, 202, { id: meeting.id, status: 'processing' }); return;
  }

  const audioMatch = path.match(/^\/api\/meetings\/([a-z0-9-]+)\/audio$/i);
  if (request.method === 'GET' && audioMatch) {
    const meeting = await requireMeeting(audioMatch[1]);
    if (!meeting.audioChunks.length) {
      sendJson(response, 404, { error: 'Audio is no longer available for this meeting' });
      return;
    }
    const chunks = await Promise.all(
      [...meeting.audioChunks]
        .sort((left, right) => chunkSequence(left) - chunkSequence(right))
        .map((file) => readFile(store.audioFile(file)))
    );
    const buffer = Buffer.concat(chunks);
    response.writeHead(200, {
      'Content-Type': 'audio/webm',
      'Content-Length': buffer.length,
      'Accept-Ranges': 'bytes',
    });
    response.end(buffer);
    return;
  }

  const retryMatch = path.match(/^\/api\/meetings\/([a-z0-9-]+)\/retry$/i);
  if (request.method === 'POST' && retryMatch) {
    const existing = await requireMeeting(retryMatch[1]);
    if (existing.status !== 'failed' && !existing.finalError) throw new Error('Only failed processing can be retried');
    const meeting = existing.finalError ? await queueFinalProcessing(existing.id) : await queueProcessing(existing.id);
    sendJson(response, 202, { id: meeting.id, status: 'processing' }); return;
  }

  const downloadMatch = path.match(/^\/api\/meetings\/([a-z0-9-]+)\/download$/i);
  if (request.method === 'GET' && downloadMatch) {
    const meeting = await requireMeeting(downloadMatch[1]);
    response.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename="meeting-${meeting.id}.md"` });
    response.end(reportAsMarkdown(meeting)); return;
  }

  const exportMatch = path.match(/^\/api\/meetings\/([a-z0-9-]+)\/export\/google-doc$/i);
  if (request.method === 'POST' && exportMatch) {
    const body = await readJson<{ mode?: 'new' | 'append'; documentId?: string }>(request);
    const exported = await exportMeetingToGoogleDoc(dataRoot, await requireMeeting(exportMatch[1]), body.mode === 'append' && body.documentId ? { mode: 'append', documentId: body.documentId } : { mode: 'new' });
    await store.update(exportMatch[1], (item) => { item.googleDocUrl = exported.url; });
    sendJson(response, 200, exported); return;
  }

  const speakerMatch = path.match(/^\/api\/meetings\/([a-z0-9-]+)\/speakers$/i);
  if (request.method === 'PATCH' && speakerMatch) {
    const body = await readJson<{ labels?: Record<string, string> }>(request);
    const labels = body.labels ?? {};
    await Promise.all(Object.values(labels).filter((name): name is string => typeof name === 'string').map((name) => knownSpeakers.remember(name)));
    sendJson(response, 200, await store.update(speakerMatch[1], (meeting) => {
      const relabel = (segments: typeof meeting.transcript) => segments.map((segment) => ({ ...segment, speakerLabel: labels[segment.speakerLabel]?.trim() || segment.speakerLabel }));
      const relabelReport = (report: typeof meeting.report) => report && { ...report, speakerStats: report.speakerStats.map((stat) => ({ ...stat, speakerLabel: labels[stat.speakerLabel]?.trim() || stat.speakerLabel })) };
      meeting.provisionalTranscript = relabel(meeting.provisionalTranscript);
      meeting.finalTranscript = relabel(meeting.finalTranscript);
      meeting.transcript = relabel(meeting.transcript);
      meeting.provisionalReport = relabelReport(meeting.provisionalReport);
      meeting.finalReport = relabelReport(meeting.finalReport);
      meeting.report = relabelReport(meeting.report);
    })); return;
  }

  const meetingMatch = path.match(/^\/api\/meetings\/([a-z0-9-]+)$/i);
  if (request.method === 'GET' && meetingMatch) { sendJson(response, 200, await requireMeeting(meetingMatch[1])); return; }
  if (request.method === 'DELETE' && meetingMatch) { await store.destroy(meetingMatch[1]); sendJson(response, 200, { ok: true }); return; }

  if (request.method === 'GET') { await serveStatic(path, response); return; }
  sendJson(response, 404, { error: 'Not found' });
}

async function requireMeeting(id: string) { const meeting = await store.get(id); if (!meeting) throw new Error('Meeting not found'); return meeting; }
async function queueProcessing(id: string, forcedFinish?: 'manual' | 'stale-sweep') {
  let shouldProcess = false;
  const meeting = await store.update(id, (item) => {
    if (item.status === 'processing') return;
    shouldProcess = true;
    item.status = 'processing'; item.processingStage = 'transcribing_fast'; item.error = undefined; item.endedAt ??= new Date().toISOString();
    if (forcedFinish) item.forcedFinish = forcedFinish;
  });
  if (shouldProcess) {
    void (async () => {
      await processProvisionalMeeting(store, meeting.id, (meetingId) => provisionalQueue.flush(meetingId), undefined, { dataRoot });
      if ((await store.get(meeting.id))?.provisionalReport) await processFinalDiarizedMeeting(store, meeting.id, dataRoot);
      await exportToMicrosoft365(store, meeting.id, dataRoot);
    })();
  }
  return meeting;
}
async function queueFinalProcessing(id: string) {
  let shouldProcess = false;
  const meeting = await store.update(id, (item) => {
    if (item.processingStage === 'diarizing') return;
    shouldProcess = true;
    item.finalError = undefined; item.processingStage = 'diarizing'; item.error = undefined;
  });
  if (shouldProcess) {
    void (async () => {
      await processFinalDiarizedMeeting(store, meeting.id, dataRoot);
      await exportToMicrosoft365(store, meeting.id, dataRoot);
    })();
  }
  return meeting;
}
async function sweepStaleRecordings(): Promise<void> {
  const now = new Date();
  for (const meeting of await store.list()) {
    if (!isStaleRecording(meeting, now)) continue;
    try { await queueProcessing(meeting.id, 'stale-sweep'); }
    catch (error) { console.error(`Failed to finish stale recording ${meeting.id}:`, error); }
  }
}
function setCors(request: IncomingMessage, response: ServerResponse) {
  const allowedOrigin = resolveAllowedOrigin(request.headers.origin);
  response.setHeader('Vary', 'Origin');
  if (allowedOrigin) response.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function sendJson(response: ServerResponse, status: number, data: unknown) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(data)); }
async function readBody(request: IncomingMessage): Promise<Buffer> { const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); return Buffer.concat(chunks); }
async function readJson<T>(request: IncomingMessage): Promise<T> { const body = await readBody(request); return body.length ? JSON.parse(body.toString('utf8')) as T : {} as T; }
async function serveStatic(path: string, response: ServerResponse): Promise<void> {
  const file = path === '/' ? 'index.html' : path.replace(/^\//, '');
  if (file.includes('..')) { sendJson(response, 400, { error: 'Invalid path' }); return; }
  try {
    const content = await readFile(join(publicRoot, file));
    response.writeHead(200, { 'Content-Type': extname(file) === '.js' ? 'text/javascript' : extname(file) === '.css' ? 'text/css' : 'text/html; charset=utf-8' }); response.end(content);
  } catch { sendJson(response, 404, { error: 'Not found' }); }
}
