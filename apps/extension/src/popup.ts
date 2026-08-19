const status = document.querySelector<HTMLParagraphElement>('#status')!;
const language = document.querySelector<HTMLSelectElement>('#language')!;
const start = document.querySelector<HTMLButtonElement>('#start')!;

start.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.startsWith('https://meet.google.com/')) { status.textContent = 'Open an active Google Meet first.'; return; }
  start.disabled = true; status.textContent = 'Starting recorder…';
  chrome.runtime.sendMessage({ type: 'START_RECORDING', explicitUserClick: true, language: language.value, tabId: tab.id }, (result) => {
    start.disabled = false;
    status.textContent = result?.ok ? 'Recording has started. You can close this window.' : result?.error ?? 'Could not start recording.';
  });
});
