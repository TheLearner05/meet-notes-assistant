import type { MeetState } from './meet-detector.js';

export function shouldShowRecordingPrompt(state: MeetState, isRecording: boolean): boolean {
  return state === 'in-call' && !isRecording;
}

export function shouldAutoStopRecording(state: MeetState, isRecording: boolean): boolean {
  return isRecording && state !== 'in-call';
}

// Covers the case shouldAutoStopRecording can't: everyone else leaves the call but the tab never
// navigates away (state stays 'in-call'), so recording would otherwise continue capturing silence
// indefinitely. participantCount undefined means detection failed (e.g. Meet changed its DOM) —
// treated as "don't stop" rather than risk cutting off a real, ongoing call.
export function shouldAutoStopForLoneParticipant(isRecording: boolean, participantCount: number | undefined, aloneDurationMs: number, graceMs: number): boolean {
  return isRecording && participantCount === 1 && aloneDurationMs >= graceMs;
}

export function recordingStatusMessage(status: 'on' | 'off' | 'paused'): string {
  if (status === 'on') return '● RECORDING ON';
  if (status === 'paused') return '❚❚ RECORDING PAUSED';
  return '✓ RECORDING OFF — Saving meeting';
}
