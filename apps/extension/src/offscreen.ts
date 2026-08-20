import { BACKEND_URL } from './config.js';
import { preserveLocalPlayback } from './offscreen-playback.js';
import { UploadTracker } from './offscreen-upload-tracker.js';

let recorder: MediaRecorder | undefined;
let meetingId: string | undefined;
let sequence = 0;
const pending: Blob[] = [];
let uploads = new UploadTracker();
let playbackContext: AudioContext | undefined;
let capturedStream: MediaStream | undefined;

async function upload(blob: Blob): Promise<void> {
  if (!meetingId) return;
  const response = await fetch(`${BACKEND_URL}/api/meetings/${meetingId}/chunks/${sequence++}`, { method: 'PUT', headers: { 'Content-Type': 'audio/webm' }, body: blob });
  if (!response.ok) throw new Error('Chunk upload failed');
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'OFFSCREEN_START') void start(message.meetingId, message.streamId);
  if (message.type === 'OFFSCREEN_STOP') void stop();
});

async function start(id: string, streamId: string): Promise<void> {
  meetingId = id; sequence = 0;
  pending.splice(0);
  uploads = new UploadTracker();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } } } as unknown as MediaStreamConstraints);
  capturedStream = stream;
  playbackContext = preserveLocalPlayback(stream);
  recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
  recorder.addEventListener('dataavailable', (event) => {
    if (!event.data.size) return;
    const uploadTask = upload(event.data).catch(() => { pending.push(event.data); });
    uploads.track(uploadTask);
  });
  recorder.start(30000);
}

async function stop(): Promise<void> {
  if (!recorder || !meetingId) return;
  const id = meetingId;
  await new Promise<void>((resolve) => { recorder?.addEventListener('stop', () => resolve(), { once: true }); recorder?.stop(); });
  await uploads.drain();
  for (const blob of pending.splice(0)) await upload(blob);
  await fetch(`${BACKEND_URL}/api/meetings/${id}/finish`, { method: 'POST' });
  capturedStream?.getTracks().forEach((track) => track.stop());
  await playbackContext?.close();
  capturedStream = undefined; playbackContext = undefined;
  recorder = undefined; meetingId = undefined;
}
