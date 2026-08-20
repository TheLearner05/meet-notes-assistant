export const ACTIVE_RECORDING_TAB_KEY = 'meetNotesActiveRecordingTabId';

export type RecordingSessionStorage = {
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (values: Record<string, unknown>) => Promise<void>;
  remove: (key: string) => Promise<void>;
};

export class RecordingSession {
  private tabId: number | undefined;
  private restored = false;

  constructor(private readonly storage: RecordingSessionStorage) {}

  async activeTabId(): Promise<number | undefined> {
    if (!this.restored) {
      const stored = (await this.storage.get(ACTIVE_RECORDING_TAB_KEY))[ACTIVE_RECORDING_TAB_KEY];
      this.tabId = typeof stored === 'number' ? stored : undefined;
      this.restored = true;
    }
    return this.tabId;
  }

  async start(tabId: number): Promise<void> {
    this.tabId = tabId;
    this.restored = true;
    await this.storage.set({ [ACTIVE_RECORDING_TAB_KEY]: tabId });
  }

  async stop(tabId: number): Promise<boolean> {
    if (await this.activeTabId() !== tabId) return false;
    this.tabId = undefined;
    await this.storage.remove(ACTIVE_RECORDING_TAB_KEY);
    return true;
  }
}
