import { getMeetState } from './content/meet-detector.js';
import { shouldShowRecordingPrompt } from './content/recording-prompt.js';

let isRecording = false;
let prompt: HTMLDivElement | undefined;

function render(): void {
  const state = getMeetState(location.href, document);
  if (!shouldShowRecordingPrompt(state, isRecording)) { prompt?.remove(); prompt = undefined; return; }
  if (prompt) return;
  prompt = document.createElement('div');
  prompt.id = 'meet-notes-assistant-prompt';
  prompt.innerHTML = `<div style="font:14px system-ui,sans-serif;position:fixed;z-index:2147483647;right:20px;bottom:20px;width:280px;padding:16px;background:white;color:#172033;border-radius:12px;box-shadow:0 8px 28px #0004"><strong>Meeting detected</strong><p style="margin:8px 0">Confirm that everyone knows this meeting is being recorded.</p><label style="display:block;margin-bottom:8px">Language <select id="mna-language" style="width:100%;margin-top:4px"><option value="auto">Auto-detect</option><option value="hi-en">Hindi / Hinglish</option><option value="mr-en">Marathi / Marathi-English</option><option value="en">English</option></select></label><button id="mna-start" style="width:100%;border:0;border-radius:7px;padding:9px;background:#2947d3;color:white;font-weight:700;cursor:pointer">Start recording</button></div>`;
  document.documentElement.append(prompt);
  prompt.querySelector<HTMLButtonElement>('#mna-start')?.addEventListener('click', () => {
    const language = prompt?.querySelector<HTMLSelectElement>('#mna-language')?.value ?? 'auto';
    chrome.runtime.sendMessage({ type: 'START_RECORDING', explicitUserClick: true, language }, (result) => {
      if (chrome.runtime.lastError || !result?.ok) { alert(result?.error ?? chrome.runtime.lastError?.message ?? 'Could not start recording'); return; }
      isRecording = true; prompt?.remove(); prompt = undefined; showRecordingBanner();
    });
  });
}

function showRecordingBanner(): void {
  const banner = document.createElement('div');
  banner.id = 'meet-notes-assistant-recording';
  banner.innerHTML = `<div style="font:14px system-ui,sans-serif;position:fixed;z-index:2147483647;right:20px;bottom:20px;padding:12px 14px;background:#9d1c20;color:white;border-radius:10px;box-shadow:0 8px 28px #0004"><strong>● Recording</strong><button style="margin-left:12px;border:0;border-radius:6px;padding:6px 8px;cursor:pointer" id="mna-stop">Stop</button></div>`;
  document.documentElement.append(banner);
  banner.querySelector<HTMLButtonElement>('#mna-stop')?.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, () => { isRecording = false; banner.remove(); render(); }));
}

new MutationObserver(render).observe(document.documentElement, { childList: true, subtree: true });
setInterval(render, 2000);
render();
