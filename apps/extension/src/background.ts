import { CaptureController } from './background/capture-controller.js';
import { isCapturableMeetTab } from './background/tab-validation.js';
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
        const tabId = message.tabId as number | undefined;
        const tab = tabId ? await chrome.tabs.get(tabId) : undefined;
        if (!tabId || !isCapturableMeetTab(tab?.url) || message.explicitUserClick !== true) throw new Error('Open an active Google Meet, then start recording from the Meet Notes extension icon.');
        const created = await fetch(`${BACKEND_URL}/api/meetings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: message.language }) });
        if (!created.ok) throw new Error('Meet Notes server is not running');
        const meeting = await created.json() as { id: string };
        await controller.start({ tabId, explicitUserClick: true });
        chrome.runtime.sendMessage({ type: 'OFFSCREEN_START', meetingId: meeting.id, streamId: streamIds.get(tabId) });
        await chrome.action.setBadgeText({ tabId, text: 'REC' });
        await chrome.tabs.sendMessage(tabId, { type: 'RECORDING_STARTED' });
        sendResponse({ ok: true });
      } catch (error) { sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Unable to start recording' }); }
    })();
    return true;
  }
  if (message.type === 'STOP_RECORDING') {
    void (async () => { const tabId = message.tabId as number | undefined ?? sender.tab?.id; chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP' }); if (tabId) { await chrome.action.setBadgeText({ tabId, text: '' }); await chrome.tabs.sendMessage(tabId, { type: 'RECORDING_STOPPED' }); } sendResponse({ ok: true }); })();
    return true;
  }
});
