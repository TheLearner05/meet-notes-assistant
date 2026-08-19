export type MeetState = 'not-meet' | 'lobby' | 'in-call' | 'ended';

const GOOGLE_MEET_HOST = 'meet.google.com';

export function getMeetState(url: string, document: Document): MeetState {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url);
  } catch {
    return 'not-meet';
  }

  if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== GOOGLE_MEET_HOST) {
    return 'not-meet';
  }

  const leaveCallControl = document.querySelector(
    '[aria-label*="Leave call"], [data-tooltip*="Leave call"], [aria-label*="End call"], [data-tooltip*="End call"]',
  );

  return leaveCallControl ? 'in-call' : 'lobby';
}

export function mayStartRecording(state: MeetState, explicitUserClick: boolean): boolean {
  return state === 'in-call' && explicitUserClick;
}
