import { getMeetingTitle, getMeetState, getParticipantCount } from './content/meet-detector.js';
import { recordingStatusMessage, shouldAutoStopForLoneParticipant, shouldAutoStopRecording, shouldShowRecordingPrompt } from './content/recording-prompt.js';

let isRecording = false;
let isPaused = false;
let isSaving = false;
let inMeetingNotes = '';
let prompt: HTMLDivElement | undefined;
let autoStopTimer: number | undefined;
let savingBannerTimer: number | undefined;
let aloneSince: number | undefined;
const AUTO_STOP_GRACE_MS = 4000;
const SAVING_BANNER_MS = 8000;
const LONE_PARTICIPANT_GRACE_MS = 30000;

function render(): void {
  const state = getMeetState(location.href, document);
  updateAutoStop(state);
  updateLoneParticipantWatch(state);
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
      chrome.runtime.sendMessage({ type: 'MEETING_ENDED', userNotes: inMeetingNotes });
      inMeetingNotes = '';
    }
  }, AUTO_STOP_GRACE_MS);
}

// Covers everyone else leaving while the tab stays on the call (shouldAutoStopRecording only
// catches navigating away from it). Runs off the same 2s render() poll as the rest of this file,
// so aloneSince tracks wall-clock time rather than a timer the poll interval would otherwise skew.
function updateLoneParticipantWatch(state: ReturnType<typeof getMeetState>): void {
  if (state !== 'in-call' || !isRecording) { aloneSince = undefined; return; }
  const participantCount = getParticipantCount(document);
  if (participantCount !== 1) { aloneSince = undefined; return; }
  if (aloneSince === undefined) aloneSince = Date.now();
  if (shouldAutoStopForLoneParticipant(isRecording, participantCount, Date.now() - aloneSince, LONE_PARTICIPANT_GRACE_MS)) {
    aloneSince = undefined;
    chrome.runtime.sendMessage({ type: 'MEETING_ENDED', userNotes: inMeetingNotes });
    inMeetingNotes = '';
  }
}

function showRecordingBanner(): void {
  isSaving = false;
  if (savingBannerTimer !== undefined) window.clearTimeout(savingBannerTimer);
  document.querySelector('#meet-notes-assistant-recording-status')?.remove();
  const banner = document.createElement('div');
  banner.id = 'meet-notes-assistant-recording-status';
  const background = isPaused ? '#8a5a00' : '#b42318';
  const description = isPaused ? 'Recording is paused for this Google Meet' : 'This Google Meet is being recorded';
  const toggleLabel = isPaused ? 'RESUME' : 'PAUSE';
  const hasNotes = Boolean(inMeetingNotes.trim());
  banner.innerHTML = `<div role="status" aria-live="assertive" style="font:14px system-ui,sans-serif;position:fixed;z-index:2147483647;top:20px;left:50%;transform:translateX(-50%);width:min(480px,calc(100vw - 32px));box-sizing:border-box;padding:16px 18px;background:${background};color:white;border:2px solid #fff8;border-radius:13px;box-shadow:0 10px 32px #0007;text-align:center"><strong style="display:block;font-size:18px;letter-spacing:.4px">${recordingStatusMessage(isPaused ? 'paused' : 'on')}</strong><span style="display:block;margin:4px 0 10px;font-size:13px;opacity:0.9">${description}</span><div style="display:flex;gap:8px;margin-bottom:8px"><button style="flex:1;border:0;border-radius:7px;padding:8px;background:#fff3;color:white;font-weight:700;cursor:pointer" id="mna-toggle-pause">${toggleLabel}</button><button style="flex:1;border:0;border-radius:7px;padding:8px;background:#fff2;color:white;font-weight:700;cursor:pointer" id="mna-toggle-notes">📝 Scratchpad</button><button style="flex:1;border:0;border-radius:7px;padding:8px;background:white;color:#8b171c;font-weight:700;cursor:pointer" id="mna-stop">STOP RECORDING</button></div><div id="mna-notes-container" style="display:${hasNotes ? 'block' : 'none'};text-align:left;margin-top:6px"><textarea id="mna-scratchpad" placeholder="Type key decisions or action items here during the call (AI prioritizes these in summary)..." style="box-sizing:border-box;width:100%;height:75px;padding:8px;border-radius:7px;border:1px solid #ffffff55;background:#ffffff15;color:white;font:13px system-ui,sans-serif;resize:vertical">${inMeetingNotes}</textarea></div></div>`;
  document.documentElement.append(banner);

  const scratchpad = banner.querySelector<HTMLTextAreaElement>('#mna-scratchpad');
  scratchpad?.addEventListener('input', () => { inMeetingNotes = scratchpad.value; });

  const toggleNotesBtn = banner.querySelector<HTMLButtonElement>('#mna-toggle-notes');
  const notesContainer = banner.querySelector<HTMLDivElement>('#mna-notes-container');
  toggleNotesBtn?.addEventListener('click', () => {
    if (notesContainer) {
      const isVisible = notesContainer.style.display !== 'none';
      notesContainer.style.display = isVisible ? 'none' : 'block';
      if (!isVisible && scratchpad) scratchpad.focus();
    }
  });

  banner.querySelector<HTMLButtonElement>('#mna-stop')?.addEventListener('click', () => {
    const notesToSend = inMeetingNotes;
    chrome.runtime.sendMessage({ type: 'STOP_RECORDING', userNotes: notesToSend }, () => {
      isRecording = false;
      isPaused = false;
      inMeetingNotes = '';
      showSavingBanner();
      render();
    });
  });

  const toggleButton = banner.querySelector<HTMLButtonElement>('#mna-toggle-pause');
  toggleButton?.addEventListener('click', () => {
    const requestedPause = !isPaused;
    toggleButton.disabled = true;
    chrome.runtime.sendMessage({ type: requestedPause ? 'PAUSE_RECORDING' : 'RESUME_RECORDING' }, (result: { ok?: boolean } | undefined) => {
      if (result?.ok) isPaused = requestedPause;
      showRecordingBanner();
    });
  });
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
  if (message.type === 'GET_MEET_STATE') {
    sendResponse({
      state: getMeetState(location.href, document),
      title: getMeetingTitle(location.href, document),
    });
    return;
  }
  if (message.type === 'RECORDING_STARTED') { isRecording = true; isPaused = false; prompt?.remove(); prompt = undefined; showRecordingBanner(); render(); }
  if (message.type === 'RECORDING_STOPPED') { isRecording = false; isPaused = false; inMeetingNotes = ''; showSavingBanner(); render(); }
});

new MutationObserver(render).observe(document.documentElement, { childList: true, subtree: true });
setInterval(render, 2000);
chrome.runtime.sendMessage({ type: 'GET_RECORDING_STATE' }, (result: { recording?: boolean; paused?: boolean } | undefined) => {
  if (result?.recording) { isRecording = true; isPaused = result.paused === true; showRecordingBanner(); }
  render();
});
