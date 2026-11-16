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
      reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.AUDIO_PLAYBACK],
      justification: 'Capture and mix Google Meet audio after the user explicitly starts recording.',
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
        const meetInfo = await getMeetInfo(tabId);
        const created = await fetch(`${BACKEND_URL}/api/meetings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            language: message.language,
            title: meetInfo?.title,
          }),
        });
        if (!created.ok) throw new Error('Meet Notes server is not running');
        const meeting = await created.json() as { id: string };
        await controller.start({ tabId, explicitUserClick: true });
        await recordingSession.start(tabId);
        chrome.runtime.sendMessage({ type: 'OFFSCREEN_START', meetingId: meeting.id, streamId: streamIds.get(tabId) });
        await chrome.action.setBadgeText({ tabId, text: 'REC' });
        try { await chrome.tabs.sendMessage(tabId, { type: 'RECORDING_STARTED' }); } catch { /* The content script will pick up state via GET_RECORDING_STATE once it's ready. */ }
        sendResponse({ ok: true });
      } catch (error) { sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Unable to start recording' }); }
    })();
    return true;
  }
  if (message.type === 'STOP_RECORDING') {
    void (async () => {
      await stopRecording(message.tabId as number | undefined ?? sender.tab?.id, message.userNotes as string | undefined);
      sendResponse({ ok: true });
    })();
    return true;
  }
  if (message.type === 'PAUSE_RECORDING') {
    void (async () => {
      const tabId = message.tabId as number | undefined ?? sender.tab?.id;
      if (tabId === undefined || await recordingSession.activeTabId() !== tabId) { sendResponse({ ok: false, error: 'This tab is not currently recording.' }); return; }
      const ack = await sendToOffscreen({ type: 'OFFSCREEN_PAUSE' });
      if (!ack?.paused) { sendResponse({ ok: false, error: 'Could not pause the recorder.' }); return; }
      await recordingSession.pause(tabId);
      await chrome.action.setBadgeText({ tabId, text: 'PAUSE' });
      sendResponse({ ok: true });
    })();
    return true;
  }
  if (message.type === 'RESUME_RECORDING') {
    void (async () => {
      const tabId = message.tabId as number | undefined ?? sender.tab?.id;
      if (tabId === undefined || await recordingSession.activeTabId() !== tabId) { sendResponse({ ok: false, error: 'This tab is not currently recording.' }); return; }
      const ack = await sendToOffscreen({ type: 'OFFSCREEN_RESUME' });
      if (ack?.paused !== false) { sendResponse({ ok: false, error: 'Could not resume the recorder.' }); return; }
      await recordingSession.resume(tabId);
      await chrome.action.setBadgeText({ tabId, text: 'REC' });
      sendResponse({ ok: true });
    })();
    return true;
  }
  if (message.type === 'MEETING_ENDED') {
    void stopRecording(sender.tab?.id, message.userNotes as string | undefined);
  }
  if (message.type === 'GET_RECORDING_STATE') {
    void (async () => {
      const tabId = sender.tab?.id;
      const recording = tabId !== undefined && await recordingSession.activeTabId() === tabId;
      if (!recording) { sendResponse({ recording: false }); return; }
      const paused = await recordingSession.isPaused();
      await chrome.action.setBadgeText({ tabId, text: paused ? 'PAUSE' : 'REC' });
      sendResponse({ recording: true, paused });
    })();
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => { void stopRecording(tabId); });
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  const url = changeInfo.url;
  if (url) void (async () => {
    if (shouldStopRecordingForNavigation(await recordingSession.activeTabId(), tabId, url)) await stopRecording(tabId);
  })();
});

async function stopRecording(tabId: number | undefined, userNotes?: string): Promise<boolean> {
  if (tabId === undefined || !await recordingSession.stop(tabId)) return false;
  const activeTabId = tabId;
  streamIds.delete(activeTabId);
  chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP', userNotes });
  await chrome.action.setBadgeText({ tabId: activeTabId, text: '' });
  try { await chrome.tabs.sendMessage(activeTabId, { type: 'RECORDING_STOPPED' }); } catch { /* The tab may already be closed. */ }
  return true;
}

async function sendToOffscreen(message: { type: string }): Promise<{ paused?: boolean } | undefined> {
  try { return await chrome.runtime.sendMessage(message) as { paused?: boolean } | undefined; }
  catch { return undefined; }
}

async function getMeetInfo(tabId: number): Promise<{ state?: 'in-call' | 'lobby' | 'ended'; title?: string } | undefined> {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'GET_MEET_STATE' }) as { state?: 'in-call' | 'lobby' | 'ended'; title?: string } | undefined;
  } catch {
    return undefined;
  }
}

async function getMeetState(tabId: number): Promise<'in-call' | 'lobby' | 'ended' | undefined> {
  const info = await getMeetInfo(tabId);
  return info?.state;
}
