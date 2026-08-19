export function isCapturableMeetTab(url: string | undefined): boolean {
  if (!url) return false;
  try { return new URL(url).protocol === 'https:' && new URL(url).hostname === 'meet.google.com'; } catch { return false; }
}

export function shouldStopRecordingForNavigation(recordingTabId: number | undefined, updatedTabId: number, url: string): boolean {
  return recordingTabId === updatedTabId && !isCapturableMeetTab(url);
}
