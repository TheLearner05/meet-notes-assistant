export interface CaptureGateway {
  ensureOffscreenDocument(): Promise<void>;
  startTabAudio(tabId: number): Promise<void>;
}

export interface OffscreenDocumentGateway {
  hasOffscreenDocument(): Promise<boolean>;
  createOffscreenDocument(): Promise<void>;
}

export function createOffscreenDocumentEnsurer(gateway: OffscreenDocumentGateway): () => Promise<void> {
  let creating: Promise<void> | undefined;
  return async () => {
    if (await gateway.hasOffscreenDocument()) return;
    if (creating) return creating;
    creating = gateway.createOffscreenDocument();
    try { await creating; } finally { creating = undefined; }
  };
}

export interface StartCaptureRequest {
  tabId: number;
  explicitUserClick: boolean;
}

export class CaptureController {
  constructor(private readonly gateway: CaptureGateway) {}

  async start(request: StartCaptureRequest): Promise<void> {
    if (!request.explicitUserClick) {
      throw new Error('Recording must be started by the user');
    }

    await this.gateway.ensureOffscreenDocument();
    await this.gateway.startTabAudio(request.tabId);
  }
}
