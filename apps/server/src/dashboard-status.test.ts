import { describe, expect, it } from 'vitest';
import { processingStatusText } from '../public/dashboard-status.js';

describe('processingStatusText', () => {
  it('shows completed initial-note sections', () => {
    expect(processingStatusText({ processingStage: 'transcribing_fast', processingProgress: { completed: 2, total: 14 } }))
      .toBe('Creating initial notes — 2 of 14 sections complete');
  });

  it('shows completed speaker-report sections', () => {
    expect(processingStatusText({ processingStage: 'diarizing', processingProgress: { completed: 5, total: 14 } }))
      .toBe('Creating speaker report — 5 of 14 sections complete');
  });
});
