import type { MeetState } from './meet-detector.js';

export function shouldShowRecordingPrompt(state: MeetState, isRecording: boolean): boolean {
  return state === 'in-call' && !isRecording;
}

export function shouldAutoStopRecording(state: MeetState, isRecording: boolean): boolean {
  return isRecording && state !== 'in-call';
}

export function recordingStatusMessage(status: 'on' | 'off'): string {
  return status === 'on' ? '● RECORDING ON' : '✓ RECORDING OFF — Saving meeting';
}
