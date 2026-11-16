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

export function getMeetingTitle(url: string, document: Document): string | undefined {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return undefined;
  }

  if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== GOOGLE_MEET_HOST) {
    return undefined;
  }

  // 1. Check DOM attribute
  const titleAttr = document.querySelector('[data-meeting-title]')?.getAttribute('data-meeting-title')?.trim();
  if (titleAttr) return titleAttr;

  // 2. Check DOM element
  const titleElem = document.querySelector('.u6vdEc, [data-self-name="meeting-title"]')?.textContent?.trim();
  if (titleElem) return titleElem;

  // 3. Check document.title pattern (e.g. "Meet - Sprint Planning - Google Chrome" or "Meet - Project Sync")
  const docTitle = document.title?.trim();
  if (docTitle) {
    const match = docTitle.match(/^Meet\s*[-–—]\s*(.+?)(?:\s*[-–—]\s*Google Chrome)?$/i);
    if (match && match[1]?.trim()) {
      return match[1].trim();
    }
  }

  // 4. Fallback to meeting code from URL (e.g. "abc-defg-hij")
  const code = parsedUrl.pathname.replace(/^\//, '').split('/')[0]?.trim();
  if (code && /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/i.test(code)) {
    return code;
  }

  return undefined;
}
