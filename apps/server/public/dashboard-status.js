const stageLabels = {
  recording: 'Recording in progress',
  transcribing_fast: 'Creating initial notes from captured audio…',
  initial_ready: 'Initial notes ready — speaker report still processing.',
  diarizing: 'Initial notes ready — creating the speaker report now.',
  final_ready: 'Speaker report ready.',
  failed: 'Processing failed.',
};

export function processingStatusText(meeting) {
  const progress = meeting.processingProgress;
  if (progress?.total && (meeting.processingStage === 'transcribing_fast' || meeting.processingStage === 'diarizing')) {
    const label = meeting.processingStage === 'diarizing' ? 'Creating speaker report' : 'Creating initial notes';
    return `${label} — ${progress.completed} of ${progress.total} sections complete${progress.retrying ? ' (retrying a section)' : ''}`;
  }
  return stageLabels[meeting.processingStage] ?? 'Processing meeting…';
}
