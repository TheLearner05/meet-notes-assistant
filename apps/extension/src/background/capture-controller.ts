export interface CaptureGateway {
  startTabAudio(tabId: number): Promise<void>;
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

    await this.gateway.startTabAudio(request.tabId);
  }
}
