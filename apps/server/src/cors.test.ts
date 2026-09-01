import { describe, expect, it } from 'vitest';
import { resolveAllowedOrigin } from './cors.js';

describe('resolveAllowedOrigin', () => {
  it('allows the Chrome extension origin that captures meetings', () => {
    expect(resolveAllowedOrigin('chrome-extension://abcdefghijklmnopabcdefghijklmnop')).toBe('chrome-extension://abcdefghijklmnopabcdefghijklmnop');
  });

  it('rejects an arbitrary website trying to read private meeting data', () => {
    expect(resolveAllowedOrigin('https://evil.example.com')).toBeUndefined();
  });

  it('rejects when no Origin header is present', () => {
    expect(resolveAllowedOrigin(undefined)).toBeUndefined();
  });

  it('allows any installed extension when no specific extension is pinned', () => {
    expect(resolveAllowedOrigin('chrome-extension://someotherextension', undefined)).toBe('chrome-extension://someotherextension');
  });

  it('allows only the pinned extension once one is configured', () => {
    expect(resolveAllowedOrigin('chrome-extension://ourextensionid', 'ourextensionid')).toBe('chrome-extension://ourextensionid');
  });

  it('rejects a different extension once one is pinned', () => {
    expect(resolveAllowedOrigin('chrome-extension://someotherextension', 'ourextensionid')).toBeUndefined();
  });
});
