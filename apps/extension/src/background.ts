import { CaptureController, createOffscreenDocumentEnsurer } from './background/capture-controller.js';
import { RecordingSession } from './background/recording-session.js';
import { isCapturableMeetTab, shouldReleaseRecordingForNewStart, shouldStopRecordingForNavigation } from './background/tab-validation.js';
import { BACKEND_URL } from './config.js';

const streamIds = new Map<number, string>();
const recordingSession = new RecordingSession(chrome.storage.session);
const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
const ensureOffscreenDocument = createOffscreenDocumentEnsurer({
  async hasOffscreenDocument() {
    const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [offscreenUrl] });
    return contexts.length > 0;
  },
  createOffscreenDocument() {
    return chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: [chrome.offscreen.Reason.USER_MEDIA],
      justification: 'Capture Google Meet audio after the user explicitly starts recording.',
    });
  },
});
const controller = new CaptureController({
  ensureOffscreenDocument,
  async startTabAudio(tabId) {
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
        const existingTabId = await recordingSession.activeTabId();
        if (existingTabId === tabId) throw new Error('This Google Meet is already being recorded.');
        if (existingTabId !== undefined) {
          if (shouldReleaseRecordingForNewStart(await getMeetState(existingTabId))) await stopRecording(existingTabId);
          else throw new Error('Stop the current recording before starting another one.');
        }
        const created = await fetch(`${BACKEND_URL}/api/meetings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: message.language }) });
        if (!created.ok) throw new Error('Meet Notes server is not running');
        const meeting = await created.json() as { id: string };
        await controller.start({ tabId, explicitUserClick: true });
        await recordingSession.start(tabId);
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
  const url = changeInfo.url;
  if (url) void (async () => {
    if (shouldStopRecordingForNavigation(await recordingSession.activeTabId(), tabId, url)) await stopRecording(tabId);
  })();
});

async function stopRecording(tabId: number | undefined): Promise<boolean> {
  if (tabId === undefined || !await recordingSession.stop(tabId)) return false;
  const activeTabId = tabId;
  streamIds.delete(activeTabId);
  chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP' });
  await chrome.action.setBadgeText({ tabId: activeTabId, text: '' });
  try { await chrome.tabs.sendMessage(activeTabId, { type: 'RECORDING_STOPPED' }); } catch { /* The tab may already be closed. */ }
  return true;
}

async function getMeetState(tabId: number): Promise<'in-call' | 'lobby' | 'ended' | undefined> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'GET_MEET_STATE' }) as { state?: 'in-call' | 'lobby' | 'ended' } | undefined;
    return response?.state;
  } catch {
    return undefined;
  }
}
