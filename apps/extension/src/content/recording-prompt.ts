import type { MeetState } from './meet-detector.js';

export function shouldShowRecordingPrompt(state: MeetState, isRecording: boolean): boolean {
  return state === 'in-call' && !isRecording;
}
