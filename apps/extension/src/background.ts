import { CaptureController } from './background/capture-controller.js';
import { BACKEND_URL } from './config.js';

const streamIds = new Map<number, string>();
let offscreenReady = false;
const controller = new CaptureController({
  async startTabAudio(tabId) {
    if (!offscreenReady) {
      await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: [chrome.offscreen.Reason.USER_MEDIA], justification: 'Capture Google Meet audio after the user explicitly starts recording.' });
      offscreenReady = true;
    }
    streamIds.set(tabId, await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }));
  },
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_RECORDING') {
    void (async () => {
      try {
        const tabId = sender.tab?.id;
        if (!tabId || !sender.url?.startsWith('https://meet.google.com/') || message.explicitUserClick !== true) throw new Error('Recording must be started from an active Google Meet tab');
        const created = await fetch(`${BACKEND_URL}/api/meetings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: message.language }) });
        if (!created.ok) throw new Error('Meet Notes server is not running');
        const meeting = await created.json() as { id: string };
        await controller.start({ tabId, explicitUserClick: true });
        chrome.runtime.sendMessage({ type: 'OFFSCREEN_START', meetingId: meeting.id, streamId: streamIds.get(tabId) });
        await chrome.action.setBadgeText({ tabId, text: 'REC' });
        sendResponse({ ok: true });
      } catch (error) { sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Unable to start recording' }); }
    })();
    return true;
  }
  if (message.type === 'STOP_RECORDING') {
    void (async () => { chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP' }); if (sender.tab?.id) await chrome.action.setBadgeText({ tabId: sender.tab.id, text: '' }); sendResponse({ ok: true }); })();
    return true;
  }
});
