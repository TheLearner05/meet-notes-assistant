export class UploadTracker {
  private readonly uploads = new Set<Promise<void>>();

  track(upload: Promise<void>): void {
    this.uploads.add(upload);
    void upload.then(() => this.uploads.delete(upload), () => this.uploads.delete(upload));
  }

  async drain(): Promise<void> {
    while (this.uploads.size) await Promise.all([...this.uploads]);
  }
}
