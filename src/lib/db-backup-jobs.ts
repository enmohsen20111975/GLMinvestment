/**
 * db-backup-jobs.ts — Module-level job tracker for DB backup operations
 * =====================================================================
 *
 * مشكلة الـ POST handler الحالي: بينفّذ كل الشغل (compress + split + commit +
 * fetch + rebase + push) في request واحد قدامه 180s timeout. لو الطلب اتقطع
 * أو المتصفح اتقفل، المستخدم ميعرفش وصل لفين.
 *
 * الحل: نموذج "background job" — الـ POST handler بيعمل الآتي:
 *   1. يولّد job_id
 *   2. يخزّن الحالة الأولية في الـ Map (module scope)
 *   3. يبدأ الشغل كـ fire-and-forget promise (من غير await)
 *   4. يرجّع فوراً بـ {job_id, status: 'running'}
 *
 * الفرونت إند بيعمل poll لـ /logs?job=ID و /status?job=ID كل 2s.
 *
 * ملاحظة: الـ Map بيفضل في memory طول ما الـ process شغال. في dev mode مع
 * Turbopack hot-reload، ممكن الـ module يتـ re-evaluate ويفقد الـ Map. لكن
 * ده مقبول للـ dev — في production (next start) الـ Map بتفضل محفوظة.
 */

import { mkdir, appendFile, readFile, access } from 'fs/promises';
import { join } from 'path';

export interface DbBackupJobState {
  id: string;
  started_at: string;
  finished_at?: string;
  running: boolean;
  phase: string;  // init | compress | split | commit | fetch | rebase | merge | push | done | error
  pct: number;    // 0-100
  logs: string[];
  errors: string[];
  warnings: string[];
  archives_created: string[];
  archives_pushed: string[];
  exit_code: number | null;
  pids?: number[];
  // final result (set when done)
  final_result?: any;
}

const jobs = new Map<string, DbBackupJobState>();

const LOG_DIR = join(process.cwd(), 'logs');

/** يضمن وجود مجلد logs */
async function ensureLogDir() {
  try {
    await access(LOG_DIR);
  } catch {
    await mkdir(LOG_DIR, { recursive: true });
  }
}

/** ينشئ job جديد ويرجّع الـ state */
export function createJob(jobId: string): DbBackupJobState {
  const state: DbBackupJobState = {
    id: jobId,
    started_at: new Date().toISOString(),
    running: true,
    phase: 'init',
    pct: 0,
    logs: [],
    errors: [],
    warnings: [],
    archives_created: [],
    archives_pushed: [],
    exit_code: null,
  };
  jobs.set(jobId, state);
  return state;
}

/** يضيف سطر للـ logs (in-memory + file) */
export async function appendLog(jobId: string, line: string) {
  const state = jobs.get(jobId);
  if (!state) return;
  const ts = new Date().toISOString();
  const fullLine = `[${ts}] ${line}`;
  state.logs.push(fullLine);
  // Keep in-memory bounded
  if (state.logs.length > 1000) {
    state.logs = state.logs.slice(-500);
  }
  // Also write to file for persistence
  try {
    await ensureLogDir();
    await appendFile(join(LOG_DIR, `db-backup-${jobId}.log`), fullLine + '\n', 'utf8');
  } catch {
    // File write failure is non-fatal — in-memory is enough
  }
}

/** يحدّث phase و pct */
export function updatePhase(jobId: string, phase: string, pct?: number) {
  const state = jobs.get(jobId);
  if (!state) return;
  state.phase = phase;
  if (pct !== undefined) state.pct = pct;
}

/** يضيف warning */
export function addWarning(jobId: string, warning: string) {
  const state = jobs.get(jobId);
  if (!state) return;
  state.warnings.push(warning);
}

/** يضيف error */
export function addError(jobId: string, error: string) {
  const state = jobs.get(jobId);
  if (!state) return;
  state.errors.push(error);
}

/** يسجّل archive اتعمل */
export function addArchiveCreated(jobId: string, archiveName: string) {
  const state = jobs.get(jobId);
  if (!state) return;
  state.archives_created.push(archiveName);
}

/** يسجّل archive اترفع */
export function addArchivePushed(jobId: string, archiveName: string) {
  const state = jobs.get(jobId);
  if (!state) return;
  state.archives_pushed.push(archiveName);
}

/** ينهي الـ job (success أو error) */
export function finishJob(jobId: string, exitCode: number, finalResult?: any) {
  const state = jobs.get(jobId);
  if (!state) return;
  state.running = false;
  state.finished_at = new Date().toISOString();
  state.exit_code = exitCode;
  state.phase = exitCode === 0 ? 'done' : 'error';
  state.pct = exitCode === 0 ? 100 : state.pct;
  state.final_result = finalResult;
}

/** يجيب state لـ job (للـ polling endpoints) */
export function getJob(jobId: string): DbBackupJobState | undefined {
  return jobs.get(jobId);
}

/** قائمة كل الـ jobs (للـ history view) */
export function listJobs(): DbBackupJobState[] {
  return Array.from(jobs.values()).sort((a, b) =>
    b.started_at.localeCompare(a.started_at)
  );
}

/** يمسح jobs قديمة (أقدم من N ساعة) */
export function cleanupOldJobs(maxAgeHours = 24) {
  const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
  for (const [id, state] of jobs.entries()) {
    const startTime = new Date(state.started_at).getTime();
    if (startTime < cutoff && !state.running) {
      jobs.delete(id);
    }
  }
}

/** يولّد job_id فريد */
export function generateJobId(): string {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * يقرأ سجل job من الـ file (للـ persistence لو الـ process اتـ reloaded)
 * لو الـ job مش في الـ Map، نجرب نقرأه من الـ file
 */
export async function readJobFromFile(jobId: string): Promise<string[]> {
  try {
    const logPath = join(LOG_DIR, `db-backup-${jobId}.log`);
    const content = await readFile(logPath, 'utf8');
    return content.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}
