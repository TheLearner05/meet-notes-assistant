import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export class KnownSpeakerStore {
  private readonly filePath: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(rootPath: string) {
    this.filePath = join(rootPath, 'known-speakers.json');
  }

  async init(): Promise<void> {
    try { await readFile(this.filePath, 'utf8'); } catch { await this.save([]); }
  }

  async list(): Promise<string[]> {
    // Routed through the same lock as remember() so a read can never observe a torn/in-progress write.
    return this.mutate(() => this.load());
  }

  async remember(name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    await this.mutate(async () => {
      const names = await this.load();
      if (names.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) return names;
      names.push(trimmed);
      names.sort((a, b) => a.localeCompare(b));
      await this.save(names);
      return names;
    });
  }

  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.writeChain;
    let release!: () => void;
    this.writeChain = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }

  private async load(): Promise<string[]> {
    try { return JSON.parse(await readFile(this.filePath, 'utf8')) as string[]; }
    catch { return []; }
  }

  private async save(names: string[]): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(names, null, 2));
  }
}
