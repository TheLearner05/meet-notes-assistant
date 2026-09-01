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

// Meet shows the participant count two different ways depending on layout: a `data-avatar-count`
// badge next to the user's own avatar (current UI, checked first since it doesn't require the
// People button to be visible), or a "People - N joined" aria-label on the People button itself.
export function getParticipantCount(document: Document): number | undefined {
  const avatarBadge = document.querySelector('[data-avatar-count]');
  const avatarCount = Number(avatarBadge?.getAttribute('data-avatar-count'));
  if (Number.isFinite(avatarCount) && avatarCount > 0) return avatarCount;

  const peopleButton = document.querySelector('button[aria-label^="People -"]');
  const match = peopleButton?.getAttribute('aria-label')?.match(/^People - (\d+)/);
  const peopleCount = Number(match?.[1]);
  if (Number.isFinite(peopleCount) && peopleCount > 0) return peopleCount;

  return undefined;
}
