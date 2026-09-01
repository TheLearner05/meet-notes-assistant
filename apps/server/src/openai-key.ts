import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

function keyPath(dataRoot: string): string { return join(dataRoot, 'openai-key.json'); }

export async function loadOpenAiKey(dataRoot: string): Promise<string | undefined> {
  try {
    const { apiKey } = JSON.parse(await readFile(keyPath(dataRoot), 'utf8')) as { apiKey?: string };
    return apiKey || undefined;
  } catch {
    return undefined;
  }
}

export async function saveOpenAiKey(dataRoot: string, apiKey: string): Promise<string> {
  const trimmed = apiKey.trim();
  if (!trimmed) throw new Error('API key is required');
  await writeFile(keyPath(dataRoot), JSON.stringify({ apiKey: trimmed }));
  process.env.OPENAI_API_KEY = trimmed;
  return trimmed;
}

// A saved key only fills in when no real environment variable is already set,
// so an explicit deployment env var always wins over one entered through the UI.
export async function applyStoredOpenAiKey(dataRoot: string): Promise<void> {
  if (process.env.OPENAI_API_KEY) return;
  const saved = await loadOpenAiKey(dataRoot);
  if (saved) process.env.OPENAI_API_KEY = saved;
}
