import { describe, expect, it } from 'vitest';
import { isCapturableMeetTab } from './tab-validation.js';

describe('isCapturableMeetTab', () => {
  it('allows an active Google Meet URL', () => {
    expect(isCapturableMeetTab('https://meet.google.com/abc-defg-hij')).toBe(true);
  });

  it('rejects non-Meet and browser pages', () => {
    expect(isCapturableMeetTab('https://example.com')).toBe(false);
    expect(isCapturableMeetTab('chrome://extensions')).toBe(false);
  });
});
