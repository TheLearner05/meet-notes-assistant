import { describe, expect, it } from 'vitest';
import { buildTaskMatchMessages, parseTaskMatchResponse, type OpenTaskRow } from './microsoft-task-matcher.js';

const openTasks: OpenTaskRow[] = [{ rowIndex: 2, task: 'Send quotation to client', owner: 'Priya', status: 'Open' }];

describe('buildTaskMatchMessages', () => {
  it('includes the meeting title, new action items, and current open tasks', () => {
    const messages = buildTaskMatchMessages('Weekly sync', [{ text: 'Send quote', ownerSpeakerLabel: 'Priya', dueDate: null }], openTasks);
    const userContent = messages.find((message) => message.role === 'user')?.content ?? '';
    expect(userContent).toContain('Weekly sync');
    expect(userContent).toContain('Send quote');
    expect(userContent).toContain('Send quotation to client');
  });
});

describe('parseTaskMatchResponse', () => {
  it('parses a well-formed new-task operation', () => {
    const operations = parseTaskMatchResponse(JSON.stringify({
      operations: [{ type: 'new', task: 'File the report', owner: 'Rahul', dueDate: '2026-09-01', status: 'Open', comment: 'Raised in the Aug 29 meeting' }],
    }), openTasks);

    expect(operations).toEqual([{ type: 'new', task: 'File the report', owner: 'Rahul', dueDate: '2026-09-01', status: 'Open', comment: 'Raised in the Aug 29 meeting' }]);
  });

  it('parses a well-formed update to an existing open row', () => {
    const operations = parseTaskMatchResponse(JSON.stringify({
      operations: [{ type: 'update', rowIndex: 2, status: 'Done', comment: 'Sent to the client on Aug 29' }],
    }), openTasks);

    expect(operations).toEqual([{ type: 'update', rowIndex: 2, status: 'Done', comment: 'Sent to the client on Aug 29' }]);
  });

  it('drops an update pointing at a row that is not in the open task list', () => {
    const operations = parseTaskMatchResponse(JSON.stringify({
      operations: [{ type: 'update', rowIndex: 999, status: 'Done', comment: 'hallucinated row' }],
    }), openTasks);

    expect(operations).toEqual([]);
  });

  it('returns no operations for empty, missing, or malformed content', () => {
    expect(parseTaskMatchResponse('', openTasks)).toEqual([]);
    expect(parseTaskMatchResponse(undefined, openTasks)).toEqual([]);
    expect(parseTaskMatchResponse('{"operations":', openTasks)).toEqual([]);
    expect(parseTaskMatchResponse('{"operations":"not an array"}', openTasks)).toEqual([]);
  });

  it('drops a new-task operation with no task text', () => {
    const operations = parseTaskMatchResponse(JSON.stringify({ operations: [{ type: 'new', task: '' }] }), openTasks);
    expect(operations).toEqual([]);
  });

  it('defaults status to Open for a new task and keeps the existing status for an update when the model omits it', () => {
    const operations = parseTaskMatchResponse(JSON.stringify({
      operations: [
        { type: 'new', task: 'Draft the agenda' },
        { type: 'update', rowIndex: 2, comment: 'Still in progress' },
      ],
    }), openTasks);

    expect(operations).toEqual([
      { type: 'new', task: 'Draft the agenda', owner: '', dueDate: null, status: 'Open', comment: '' },
      { type: 'update', rowIndex: 2, status: 'Open', comment: 'Still in progress' },
    ]);
  });
});
