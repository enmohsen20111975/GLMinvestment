/**
 * Internal Scheduler
 * نظام جدولة داخلي - يشتغل تلقائياً عند زيارة الموقع
 * 
 * بدلاً من الاعتماد على cron jobs خارجية،
 * النظام يفحص عند كل طلب هل حان وقت تشغيل المهمة
 */

import { db } from '@/lib/db';

interface TaskRun {
  id: string;
  task_id: string;
  last_run: Date;
  next_run: Date;
  status: string;
  result?: string;
}

// Task IDs
export const TASK_IDS = {
  EGX_PREDICTIONS: 'egx_predictions',
  CRYPTO_PREDICTIONS: 'crypto_predictions',
  VERIFY_PREDICTIONS: 'verify_predictions',
  MEMORY_CLEANUP: 'memory_cleanup'
} as const;

// Check if task should run
export async function shouldRunTask(taskId: string, intervalHours: number = 24): Promise<boolean> {
  try {
    // Get last run from DB
    const lastRun = await db.$queryRaw<TaskRun[]>`
      SELECT * FROM task_runs 
      WHERE task_id = ${taskId} 
      ORDER BY last_run DESC 
      LIMIT 1
    `;

    if (!lastRun || lastRun.length === 0) {
      return true; // Never run before
    }

    const lastRunTime = new Date(lastRun[0].last_run);
    const nextRunTime = new Date(lastRunTime.getTime() + intervalHours * 60 * 60 * 1000);

    return new Date() >= nextRunTime;

  } catch (error) {
    // Table might not exist yet
    return true;
  }
}

// Mark task as running
export async function startTaskRun(taskId: string): Promise<string> {
  const runId = `${taskId}_${Date.now()}`;

  try {
    await db.$executeRaw`
      INSERT INTO task_runs (id, task_id, last_run, status)
      VALUES (${runId}, ${taskId}, ${new Date()}, 'running')
    `;
  } catch (error) {
    // Table might not exist, create it
    await db.$executeRaw`
      CREATE TABLE IF NOT EXISTS task_runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        last_run DATETIME NOT NULL,
        status TEXT DEFAULT 'running',
        result TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;
    
    await db.$executeRaw`
      INSERT INTO task_runs (id, task_id, last_run, status)
      VALUES (${runId}, ${taskId}, ${new Date()}, 'running')
    `;
  }

  return runId;
}

// Mark task as completed
export async function endTaskRun(runId: string, result?: string): Promise<void> {
  try {
    await db.$executeRaw`
      UPDATE task_runs 
      SET status = 'completed', result = ${result || null}
      WHERE id = ${runId}
    `;
  } catch (error) {
    console.error('Error ending task run:', error);
  }
}

// Run task if needed
export async function runTaskIfNeeded(
  taskId: string,
  taskFn: () => Promise<string>,
  intervalHours: number = 24
): Promise<{ ran: boolean; result?: string }> {
  const shouldRun = await shouldRunTask(taskId, intervalHours);

  if (!shouldRun) {
    return { ran: false };
  }

  const runId = await startTaskRun(taskId);

  try {
    const result = await taskFn();
    await endTaskRun(runId, result);
    return { ran: true, result };
  } catch (error: any) {
    await endTaskRun(runId, `Error: ${error.message}`);
    throw error;
  }
}

// Initialize task_runs table
export async function initScheduler(): Promise<void> {
  try {
    await db.$executeRaw`
      CREATE TABLE IF NOT EXISTS task_runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        last_run DATETIME NOT NULL,
        status TEXT DEFAULT 'pending',
        result TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;
    
    await db.$executeRaw`
      CREATE INDEX IF NOT EXISTS idx_task_runs_task_id ON task_runs(task_id)
    `;
    
    await db.$executeRaw`
      CREATE INDEX IF NOT EXISTS idx_task_runs_last_run ON task_runs(last_run)
    `;
  } catch (error) {
    console.error('Error initializing scheduler:', error);
  }
}
