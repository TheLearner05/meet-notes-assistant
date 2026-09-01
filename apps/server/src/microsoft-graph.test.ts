import { describe, expect, it } from 'vitest';
import { graphItemUrl, microsoftConfigured } from './microsoft-graph.js';

describe('graphItemUrl', () => {
  it('encodes each path segment while keeping slashes as separators, with no suffix', () => {
    expect(graphItemUrl('/Meeting Reports/Running Report.docx')).toBe('https://graph.microsoft.com/v1.0/me/drive/root:/Meeting%20Reports/Running%20Report.docx');
  });

  it('appends the given suffix after a closing colon', () => {
    expect(graphItemUrl('/Meeting Reports/Tasks.xlsx', '/content')).toBe('https://graph.microsoft.com/v1.0/me/drive/root:/Meeting%20Reports/Tasks.xlsx:/content');
  });

  it('tolerates a path with no leading slash', () => {
    expect(graphItemUrl('Tasks.xlsx')).toBe('https://graph.microsoft.com/v1.0/me/drive/root:/Tasks.xlsx');
  });

  it('never leaves a bare trailing colon when no suffix is given', () => {
    expect(graphItemUrl('Tasks.xlsx')).not.toMatch(/:$/);
  });
});

describe('microsoftConfigured', () => {
  it('is false when the client id or secret is missing', () => {
    const original = { id: process.env.MICROSOFT_CLIENT_ID, secret: process.env.MICROSOFT_CLIENT_SECRET };
    delete process.env.MICROSOFT_CLIENT_ID;
    delete process.env.MICROSOFT_CLIENT_SECRET;
    try {
      expect(microsoftConfigured()).toBe(false);
    } finally {
      if (original.id !== undefined) process.env.MICROSOFT_CLIENT_ID = original.id;
      if (original.secret !== undefined) process.env.MICROSOFT_CLIENT_SECRET = original.secret;
    }
  });

  it('is true once both the client id and secret are set', () => {
    const original = { id: process.env.MICROSOFT_CLIENT_ID, secret: process.env.MICROSOFT_CLIENT_SECRET };
    process.env.MICROSOFT_CLIENT_ID = 'client';
    process.env.MICROSOFT_CLIENT_SECRET = 'secret';
    try {
      expect(microsoftConfigured()).toBe(true);
    } finally {
      if (original.id === undefined) delete process.env.MICROSOFT_CLIENT_ID; else process.env.MICROSOFT_CLIENT_ID = original.id;
      if (original.secret === undefined) delete process.env.MICROSOFT_CLIENT_SECRET; else process.env.MICROSOFT_CLIENT_SECRET = original.secret;
    }
  });
});
