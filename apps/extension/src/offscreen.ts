import { BACKEND_URL } from './config.js';
import { createAudioMixer, type AudioMixer } from './audio-mixer.js';
import { UploadTracker } from './offscreen-upload-tracker.js';

let recorder: MediaRecorder | undefined;
let meetingId: string | undefined;
let sequence = 0;
const pending: Blob[] = [];
let uploads = new UploadTracker();
let audioMixer: AudioMixer | undefined;

async function upload(blob: Blob): Promise<void> {
  if (!meetingId) return;
  const response = await fetch(`${BACKEND_URL}/api/meetings/${meetingId}/chunks/${sequence++}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'audio/webm' },
    body: blob,
  });
  if (!response.ok) throw new Error('Chunk upload failed');
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'OFFSCREEN_START') void start(message.meetingId, message.streamId);
  if (message.type === 'OFFSCREEN_STOP') void stop(message.userNotes as string | undefined);
  if (message.type === 'OFFSCREEN_PAUSE') {
    if (recorder?.state === 'recording') recorder.pause();
    sendResponse({ paused: recorder?.state === 'paused' });
    return true;
  }
  if (message.type === 'OFFSCREEN_RESUME') {
    if (recorder?.state === 'paused') recorder.resume();
    sendResponse({ paused: recorder?.state === 'paused' });
    return true;
  }
});

async function acquireMicrophoneStream(): Promise<MediaStream | undefined> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (err) {
    console.warn('Microphone stream unavailable, falling back to tab audio only:', err);
    return undefined;
  }
}

async function start(id: string, streamId: string): Promise<void> {
  meetingId = id;
  sequence = 0;
  pending.splice(0);
  uploads = new UploadTracker();

  const tabStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
  } as unknown as MediaStreamConstraints);

  const micStream = await acquireMicrophoneStream();

  audioMixer = createAudioMixer({ tabStream, micStream });

  recorder = new MediaRecorder(audioMixer.mixedStream, { mimeType: 'audio/webm;codecs=opus' });
  recorder.addEventListener('dataavailable', (event) => {
    if (!event.data.size) return;
    const uploadTask = upload(event.data).catch(() => {
      pending.push(event.data);
    });
    uploads.track(uploadTask);
  });
  recorder.start(30000);
}

async function stop(userNotes?: string): Promise<void> {
  if (!recorder || !meetingId) return;
  const id = meetingId;
  await new Promise<void>((resolve) => {
    recorder?.addEventListener('stop', () => resolve(), { once: true });
    recorder?.stop();
  });
  await uploads.drain();
  for (const blob of pending.splice(0)) await upload(blob);
  await fetch(`${BACKEND_URL}/api/meetings/${id}/finish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(userNotes?.trim() ? { userNotes: userNotes.trim() } : {}),
  });
  await audioMixer?.close();
  audioMixer = undefined;
  recorder = undefined;
  meetingId = undefined;
}
