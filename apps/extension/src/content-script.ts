import { getMeetState } from './content/meet-detector.js';
import { recordingStatusMessage, shouldAutoStopRecording, shouldShowRecordingPrompt } from './content/recording-prompt.js';

let isRecording = false;
let isSaving = false;
let prompt: HTMLDivElement | undefined;
let autoStopTimer: number | undefined;
let savingBannerTimer: number | undefined;
const AUTO_STOP_GRACE_MS = 4000;
const SAVING_BANNER_MS = 8000;

function render(): void {
  const state = getMeetState(location.href, document);
  updateAutoStop(state);
  if (!shouldShowRecordingPrompt(state, isRecording || isSaving)) { prompt?.remove(); prompt = undefined; return; }
  if (prompt) return;
  prompt = document.createElement('div');
  prompt.id = 'meet-notes-assistant-prompt';
  prompt.innerHTML = `<div role="status" style="font:13px system-ui,sans-serif;position:fixed;z-index:2147483647;right:16px;bottom:16px;width:220px;padding:10px 12px;background:#fff;color:#172033;border:1px solid #d9deea;border-radius:10px;box-shadow:0 5px 16px #0002"><strong style="display:block">Meeting ready</strong><span style="display:block;margin-top:3px;color:#5c6575">Click the extension icon to record.</span></div>`;
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
  isSaving = false;
  if (savingBannerTimer !== undefined) window.clearTimeout(savingBannerTimer);
  document.querySelector('#meet-notes-assistant-recording-status')?.remove();
  const banner = document.createElement('div');
  banner.id = 'meet-notes-assistant-recording-status';
  banner.innerHTML = `<div role="status" aria-live="assertive" style="font:15px system-ui,sans-serif;position:fixed;z-index:2147483647;top:20px;left:50%;transform:translateX(-50%);width:min(440px,calc(100vw - 32px));box-sizing:border-box;padding:16px 18px;background:#b42318;color:white;border:2px solid #fff8;border-radius:13px;box-shadow:0 10px 32px #0007;text-align:center"><strong style="display:block;font-size:20px;letter-spacing:.4px">${recordingStatusMessage('on')}</strong><span style="display:block;margin:5px 0 12px">This Google Meet is being recorded</span><button style="width:100%;border:0;border-radius:7px;padding:9px;background:white;color:#8b171c;font-weight:800;cursor:pointer" id="mna-stop">STOP RECORDING</button></div>`;
  document.documentElement.append(banner);
  banner.querySelector<HTMLButtonElement>('#mna-stop')?.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, () => { isRecording = false; showSavingBanner(); render(); }));
}

function showSavingBanner(): void {
  isSaving = true;
  prompt?.remove();
  prompt = undefined;
  document.querySelector('#meet-notes-assistant-recording-status')?.remove();
  if (savingBannerTimer !== undefined) window.clearTimeout(savingBannerTimer);
  const banner = document.createElement('div');
  banner.id = 'meet-notes-assistant-recording-status';
  banner.innerHTML = `<div role="status" aria-live="assertive" style="font:15px system-ui,sans-serif;position:fixed;z-index:2147483647;top:20px;left:50%;transform:translateX(-50%);width:min(440px,calc(100vw - 32px));box-sizing:border-box;padding:18px;background:#067647;color:white;border:2px solid #fff8;border-radius:13px;box-shadow:0 10px 32px #0007;text-align:center"><strong style="display:block;font-size:20px;letter-spacing:.2px">${recordingStatusMessage('off')}</strong><span style="display:block;margin-top:6px">Your meeting is now being prepared for transcription.</span></div>`;
  document.documentElement.append(banner);
  savingBannerTimer = window.setTimeout(() => { isSaving = false; banner.remove(); render(); }, SAVING_BANNER_MS);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_MEET_STATE') { sendResponse({ state: getMeetState(location.href, document) }); return; }
  if (message.type === 'RECORDING_STARTED') { isRecording = true; prompt?.remove(); prompt = undefined; showRecordingBanner(); render(); }
  if (message.type === 'RECORDING_STOPPED') { isRecording = false; showSavingBanner(); render(); }
});

new MutationObserver(render).observe(document.documentElement, { childList: true, subtree: true });
setInterval(render, 2000);
render();
