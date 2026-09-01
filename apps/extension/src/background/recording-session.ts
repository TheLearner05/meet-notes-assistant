export const ACTIVE_RECORDING_TAB_KEY = 'meetNotesActiveRecordingTabId';
export const RECORDING_PAUSED_KEY = 'meetNotesRecordingPaused';

export type RecordingSessionStorage = {
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (values: Record<string, unknown>) => Promise<void>;
  remove: (key: string) => Promise<void>;
};

export class RecordingSession {
  private tabId: number | undefined;
  private paused = false;
  private restored = false;

  constructor(private readonly storage: RecordingSessionStorage) {}

  async activeTabId(): Promise<number | undefined> {
    await this.restore();
    return this.tabId;
  }

  async isPaused(): Promise<boolean> {
    await this.restore();
    return this.paused;
  }

  async start(tabId: number): Promise<void> {
    this.tabId = tabId;
    this.paused = false;
    this.restored = true;
    await this.storage.set({ [ACTIVE_RECORDING_TAB_KEY]: tabId });
    await this.storage.remove(RECORDING_PAUSED_KEY);
  }

  async pause(tabId: number): Promise<boolean> {
    if (await this.activeTabId() !== tabId) return false;
    this.paused = true;
    await this.storage.set({ [RECORDING_PAUSED_KEY]: true });
    return true;
  }

  async resume(tabId: number): Promise<boolean> {
    if (await this.activeTabId() !== tabId) return false;
    this.paused = false;
    await this.storage.remove(RECORDING_PAUSED_KEY);
    return true;
  }

  async stop(tabId: number): Promise<boolean> {
    if (await this.activeTabId() !== tabId) return false;
    this.tabId = undefined;
    this.paused = false;
    await this.storage.remove(ACTIVE_RECORDING_TAB_KEY);
    await this.storage.remove(RECORDING_PAUSED_KEY);
    return true;
  }

  private async restore(): Promise<void> {
    if (this.restored) return;
    const stored = await this.storage.get(ACTIVE_RECORDING_TAB_KEY);
    this.tabId = typeof stored[ACTIVE_RECORDING_TAB_KEY] === 'number' ? stored[ACTIVE_RECORDING_TAB_KEY] as number : undefined;
    const pausedStored = await this.storage.get(RECORDING_PAUSED_KEY);
    this.paused = pausedStored[RECORDING_PAUSED_KEY] === true;
    this.restored = true;
  }
}
