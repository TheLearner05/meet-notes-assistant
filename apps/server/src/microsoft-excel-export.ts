import ExcelJS from 'exceljs';
import { graphItemUrl, graphRequest } from './microsoft-graph.js';
import type { OpenTaskRow, TaskOperation } from './microsoft-task-matcher.js';

const TASK_COLUMNS = ['Task', 'Owner', 'Due Date', 'Status', 'Source Meeting', 'Date Added', 'Last Updated', 'Comments'];

export type TasksWorkbook = { workbook: ExcelJS.Workbook; sheet: ExcelJS.Worksheet };

async function downloadWorkbook(accessToken: string, path: string): Promise<ExcelJS.Workbook | undefined> {
  const response = await fetch(graphItemUrl(path, '/content'), { headers: { Authorization: `Bearer ${accessToken}` } });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Could not download the task workbook (${response.status}): ${await response.text().catch(() => response.statusText)}`);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await response.arrayBuffer());
  return workbook;
}

export async function readOpenTaskRows(accessToken: string, path: string): Promise<{ workbook: TasksWorkbook; openTasks: OpenTaskRow[] }> {
  const workbook = (await downloadWorkbook(accessToken, path)) ?? new ExcelJS.Workbook();
  const sheet = workbook.getWorksheet('Tasks') ?? workbook.addWorksheet('Tasks');
  if (sheet.rowCount === 0) sheet.addRow(TASK_COLUMNS);

  const openTasks: OpenTaskRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const task = String(row.getCell(1).value ?? '').trim();
    const status = String(row.getCell(4).value ?? '').trim();
    if (task && status.toLowerCase() !== 'done') openTasks.push({ rowIndex: rowNumber, task, owner: String(row.getCell(2).value ?? ''), status });
  });
  return { workbook: { workbook, sheet }, openTasks };
}

export async function applyTaskOperations(accessToken: string, path: string, { workbook, sheet }: TasksWorkbook, meetingTitle: string, operations: TaskOperation[]): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  for (const operation of operations) {
    if (operation.type === 'new') {
      sheet.addRow([operation.task, operation.owner, operation.dueDate ?? '', operation.status, meetingTitle, today, today, operation.comment]);
      continue;
    }
    const row = sheet.getRow(operation.rowIndex);
    row.getCell(4).value = operation.status;
    row.getCell(7).value = today;
    row.getCell(8).value = operation.comment;
    row.commit();
  }
  const buffer = await workbook.xlsx.writeBuffer();
  await graphRequest(accessToken, graphItemUrl(path, '/content'), { method: 'PUT', contentType: 'application/octet-stream', body: new Uint8Array(buffer) });
}
