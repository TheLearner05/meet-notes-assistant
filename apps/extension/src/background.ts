import { CaptureController } from './background/capture-controller.js';
import { isCapturableMeetTab, shouldStopRecordingForNavigation } from './background/tab-validation.js';
import { BACKEND_URL } from './config.js';

const streamIds = new Map<number, string>();
let offscreenReady = false;
let recordingTabId: number | undefined;
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
        if (recordingTabId !== undefined) throw new Error('Stop the current recording before starting another one.');
        const created = await fetch(`${BACKEND_URL}/api/meetings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: message.language }) });
        if (!created.ok) throw new Error('Meet Notes server is not running');
        const meeting = await created.json() as { id: string };
        await controller.start({ tabId, explicitUserClick: true });
        recordingTabId = tabId;
        chrome.runtime.sendMessage({ type: 'OFFSCREEN_START', meetingId: meeting.id, streamId: streamIds.get(tabId) });
        await chrome.action.setBadgeText({ tabId, text: 'REC' });
        await chrome.tabs.sendMessage(tabId, { type: 'RECORDING_STARTED' });
        sendResponse({ ok: true });
      } catch (error) { sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Unable to start recording' }); }
    })();
    return true;
  }
  if (message.type === 'STOP_RECORDING') {
    void (async () => { await stopRecording(message.tabId as number | undefined ?? sender.tab?.id); sendResponse({ ok: true }); })();
    return true;
  }
  if (message.type === 'MEETING_ENDED') { void stopRecording(sender.tab?.id); }
});

chrome.tabs.onRemoved.addListener((tabId) => { void stopRecording(tabId); });
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url && shouldStopRecordingForNavigation(recordingTabId, tabId, changeInfo.url)) void stopRecording(tabId);
});

async function stopRecording(tabId: number | undefined): Promise<boolean> {
  if (recordingTabId === undefined || recordingTabId !== tabId) return false;
  const activeTabId = recordingTabId;
  recordingTabId = undefined;
  streamIds.delete(activeTabId);
  chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP' });
  await chrome.action.setBadgeText({ tabId: activeTabId, text: '' });
  try { await chrome.tabs.sendMessage(activeTabId, { type: 'RECORDING_STOPPED' }); } catch { /* The tab may already be closed. */ }
  return true;
}
