import { getMeetState } from './content/meet-detector.js';
import { shouldAutoStopRecording, shouldShowRecordingPrompt } from './content/recording-prompt.js';

let isRecording = false;
let prompt: HTMLDivElement | undefined;
let autoStopTimer: number | undefined;
const AUTO_STOP_GRACE_MS = 4000;

function render(): void {
  const state = getMeetState(location.href, document);
  updateAutoStop(state);
  if (!shouldShowRecordingPrompt(state, isRecording)) { prompt?.remove(); prompt = undefined; return; }
  if (prompt) return;
  prompt = document.createElement('div');
  prompt.id = 'meet-notes-assistant-prompt';
  prompt.innerHTML = `<div style="font:14px system-ui,sans-serif;position:fixed;z-index:2147483647;right:20px;bottom:20px;width:280px;padding:16px;background:white;color:#172033;border-radius:12px;box-shadow:0 8px 28px #0004"><strong>Meeting detected</strong><p style="margin:8px 0">Confirm that everyone knows this meeting is being recorded, then click the <strong>Meet Notes Assistant</strong> icon in Chrome's toolbar to start.</p></div>`;
  document.documentElement.append(prompt);
}

function updateAutoStop(state: ReturnType<typeof getMeetState>): void {
  if (!shouldAutoStopRecording(state, isRecording)) {
    if (autoStopTimer !== undefined) window.clearTimeout(autoStopTimer);
    autoStopTimer = undefined;
    return;
  }
  if (autoStopTimer !== undefined) return;
  autoStopTimer = window.setTimeout(() => {
    autoStopTimer = undefined;
    if (shouldAutoStopRecording(getMeetState(location.href, document), isRecording)) {
      chrome.runtime.sendMessage({ type: 'MEETING_ENDED' });
    }
  }, AUTO_STOP_GRACE_MS);
}

function showRecordingBanner(): void {
  const banner = document.createElement('div');
  banner.id = 'meet-notes-assistant-recording';
  banner.innerHTML = `<div style="font:14px system-ui,sans-serif;position:fixed;z-index:2147483647;right:20px;bottom:20px;padding:12px 14px;background:#9d1c20;color:white;border-radius:10px;box-shadow:0 8px 28px #0004"><strong>● Recording</strong><button style="margin-left:12px;border:0;border-radius:6px;padding:6px 8px;cursor:pointer" id="mna-stop">Stop</button></div>`;
  document.documentElement.append(banner);
  banner.querySelector<HTMLButtonElement>('#mna-stop')?.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, () => { isRecording = false; banner.remove(); render(); }));
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'RECORDING_STARTED') { isRecording = true; prompt?.remove(); prompt = undefined; showRecordingBanner(); render(); }
  if (message.type === 'RECORDING_STOPPED') { isRecording = false; document.querySelector('#meet-notes-assistant-recording')?.remove(); render(); }
});

new MutationObserver(render).observe(document.documentElement, { childList: true, subtree: true });
setInterval(render, 2000);
render();
