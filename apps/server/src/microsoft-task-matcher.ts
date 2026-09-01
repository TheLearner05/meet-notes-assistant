import type { MeetingReport } from './meeting-store.js';

export type OpenTaskRow = { rowIndex: number; task: string; owner: string; status: string };

export type TaskOperation =
  | { type: 'new'; task: string; owner: string; dueDate: string | null; status: string; comment: string }
  | { type: 'update'; rowIndex: number; status: string; comment: string };

export function buildTaskMatchMessages(meetingTitle: string, actionItems: MeetingReport['actionItems'], openTasks: OpenTaskRow[]): { role: 'system' | 'user'; content: string }[] {
  return [
    {
      role: 'system',
      content: 'You track action items across meetings in a shared task sheet. For each new action item, decide whether it is a brand-new task or an update to one of the open tasks listed below (only if it is clearly the same task, even if reworded). Reply with strict JSON: { "operations": [ { "type": "new", "task": string, "owner": string, "dueDate": string|null, "status": string, "comment": string } | { "type": "update", "rowIndex": number, "status": string, "comment": string } ] }. Only use "update" with a rowIndex that appears in the open task list. Keep each comment under 20 words and specific to this meeting.',
    },
    { role: 'user', content: JSON.stringify({ meeting: meetingTitle, newActionItems: actionItems, openTasks }) },
  ];
}

export function parseTaskMatchResponse(content: string | null | undefined, openTasks: OpenTaskRow[]): TaskOperation[] {
  if (!content?.trim()) return [];
  let parsed: { operations?: unknown[] };
  try { parsed = JSON.parse(content) as { operations?: unknown[] }; }
  catch { return []; }
  if (!Array.isArray(parsed.operations)) return [];

  const openRows = new Map(openTasks.map((row) => [row.rowIndex, row]));
  return parsed.operations.flatMap((raw): TaskOperation[] => {
    if (!raw || typeof raw !== 'object') return [];
    const op = raw as Record<string, unknown>;
    if (op.type === 'new' && typeof op.task === 'string' && op.task.trim()) {
      return [{
        type: 'new',
        task: op.task.trim(),
        owner: typeof op.owner === 'string' ? op.owner : '',
        dueDate: typeof op.dueDate === 'string' && op.dueDate ? op.dueDate : null,
        status: typeof op.status === 'string' && op.status ? op.status : 'Open',
        comment: typeof op.comment === 'string' ? op.comment : '',
      }];
    }
    if (op.type === 'update' && typeof op.rowIndex === 'number' && openRows.has(op.rowIndex)) {
      return [{
        type: 'update',
        rowIndex: op.rowIndex,
        status: typeof op.status === 'string' && op.status ? op.status : openRows.get(op.rowIndex)!.status,
        comment: typeof op.comment === 'string' ? op.comment : '',
      }];
    }
    return [];
  });
}
