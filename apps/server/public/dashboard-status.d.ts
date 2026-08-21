export type DashboardMeeting = {
  processingStage?: string;
  processingProgress?: { completed: number; total: number; retrying?: number };
};

export function processingStatusText(meeting: DashboardMeeting): string;
