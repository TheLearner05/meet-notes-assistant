import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ConfidentialClientApplication } from '@azure/msal-node';

const scopes = ['Files.ReadWrite', 'offline_access'];

export function microsoftConfigured(): boolean {
  return Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
}

function redirectUri(): string {
  return process.env.MICROSOFT_REDIRECT_URI ?? 'http://localhost:8787/api/microsoft/callback';
}

function client(): ConfidentialClientApplication {
  return new ConfidentialClientApplication({
    auth: {
      clientId: process.env.MICROSOFT_CLIENT_ID ?? '',
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
      authority: `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID ?? 'common'}`,
    },
  });
}

function tokenCachePath(dataRoot: string): string { return join(dataRoot, 'microsoft-token.json'); }

// The token cache file is read, refreshed, and rewritten on every export call; concurrent exports
// (e.g. two meetings finishing back to back) would otherwise race on the same file and could clobber
// each other's rotated refresh token, so every read-modify-write cycle is serialized through this chain.
let tokenCacheWriteChain: Promise<void> = Promise.resolve();
async function withTokenCacheLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = tokenCacheWriteChain;
  let release!: () => void;
  tokenCacheWriteChain = new Promise((resolve) => { release = resolve; });
  await previous;
  try { return await operation(); } finally { release(); }
}

export async function microsoftAuthorizationUrl(): Promise<string> {
  if (!microsoftConfigured()) throw new Error('Microsoft 365 is not configured');
  return client().getAuthCodeUrl({ scopes, redirectUri: redirectUri() });
}

export async function saveMicrosoftCode(dataRoot: string, code: string): Promise<void> {
  await withTokenCacheLock(async () => {
    const app = client();
    await app.acquireTokenByCode({ code, scopes, redirectUri: redirectUri() });
    await writeFile(tokenCachePath(dataRoot), app.getTokenCache().serialize());
  });
}

export async function hasMicrosoftConnection(dataRoot: string): Promise<boolean> {
  try { await readFile(tokenCachePath(dataRoot), 'utf8'); return true; }
  catch { return false; }
}

export async function acquireGraphAccessToken(dataRoot: string): Promise<string> {
  return withTokenCacheLock(async () => {
    const app = client();
    let cache: string;
    try { cache = await readFile(tokenCachePath(dataRoot), 'utf8'); }
    catch { throw new Error('Connect Microsoft 365 first'); }
    app.getTokenCache().deserialize(cache);
    const account = (await app.getTokenCache().getAllAccounts())[0];
    if (!account) throw new Error('Connect Microsoft 365 first');
    const result = await app.acquireTokenSilent({ account, scopes });
    await writeFile(tokenCachePath(dataRoot), app.getTokenCache().serialize());
    if (!result?.accessToken) throw new Error('Could not refresh the Microsoft 365 access token');
    return result.accessToken;
  });
}

export function graphItemUrl(path: string, suffix = ''): string {
  const encoded = path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  const base = `https://graph.microsoft.com/v1.0/me/drive/root:/${encoded}`;
  return suffix ? `${base}:${suffix}` : base;
}

export async function graphRequest(accessToken: string, url: string, init: { method?: string; jsonBody?: unknown; body?: BodyInit; contentType?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
  let body: BodyInit | undefined = init.body;
  if (init.jsonBody !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(init.jsonBody); }
  else if (init.contentType) headers['Content-Type'] = init.contentType;
  const response = await fetch(url, { method: init.method ?? 'GET', headers, body });
  if (!response.ok) throw new Error(`Microsoft Graph request failed (${response.status}): ${await response.text().catch(() => response.statusText)}`);
  return response;
}
