/**
 * Scheduled Learning System - نظام التعلم المجدول
 * 
 * يقوم بتشغيل التعلم التكراري تلقائياً:
 * - كل يوم أحد (بداية الأسبوع)
 * - أو عند تحديث بيانات الأسعار
 */

import { startIntelligentLearning, getIntelligentLearningProgress, type LearningProgress } from './intelligent-learning';
import { db } from '@/lib/db';

// ==================== SCHEDULER STATE ====================

interface ScheduledLearningState {
  last_run: string | null;
  next_run: string | null;
  is_running: boolean;
  auto_learning_enabled: boolean;
  schedule_day: number; // 0 = Sunday, 1 = Monday, etc.
  schedule_hour: number; // 0-23
  last_win_rate: number | null;
  total_runs: number;
  best_win_rate_ever: number;
}

let schedulerState: ScheduledLearningState = {
  last_run: null,
  next_run: null,
  is_running: false,
  auto_learning_enabled: true,
  schedule_day: 0, // Sunday
  schedule_hour: 2, // 2 AM
  last_win_rate: null,
  total_runs: 0,
  best_win_rate_ever: 0
};

// ==================== LOAD FROM DATABASE ====================

async function loadSchedulerState(): Promise<ScheduledLearningState> {
  try {
    // Try to load from database or file
    // For now, return default state
    return schedulerState;
  } catch {
    return schedulerState;
  }
}

async function saveSchedulerState(state: ScheduledLearningState): Promise<void> {
  schedulerState = state;
  // Could save to database/file here
}

// ==================== SCHEDULE CALCULATIONS ====================

function getNextRunTime(state: ScheduledLearningState): Date {
  const now = new Date();
  const next = new Date();
  
  // Set to the schedule day and hour
  const daysUntilTarget = (state.schedule_day - now.getDay() + 7) % 7;
  next.setDate(now.getDate() + daysUntilTarget);
  next.setHours(state.schedule_hour, 0, 0, 0);
  
  // If today is the target day but hour has passed, move to next week
  if (daysUntilTarget === 0 && now.getHours() >= state.schedule_hour) {
    next.setDate(next.getDate() + 7);
  }
  
  return next;
}

// ==================== MAIN SCHEDULER ====================

let schedulerInterval: ReturnType<typeof setInterval> | null = null;

/**
 * بدء المجدول
 */
export function startLearningScheduler(): void {
  if (schedulerInterval) {
    console.log('[LearningScheduler] Already running');
    return;
  }
  
  console.log('[LearningScheduler] Starting scheduler...');
  
  // Check every hour
  schedulerInterval = setInterval(async () => {
    await checkAndRunLearning();
  }, 60 * 60 * 1000); // 1 hour
  
  // Also check immediately
  checkAndRunLearning();
}

/**
 * إيقاف المجدول
 */
export function stopLearningScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('[LearningScheduler] Stopped');
  }
}

/**
 * التحقق وتشغيل التعلم إذا لزم الأمر
 */
async function checkAndRunLearning(): Promise<void> {
  const state = await loadSchedulerState();
  
  if (!state.auto_learning_enabled || state.is_running) {
    return;
  }
  
  const now = new Date();
  const nextRun = getNextRunTime(state);
  
  // Update next_run
  state.next_run = nextRun.toISOString();
  
  // Check if it's time to run
  const shouldRun = 
    state.last_run === null || // Never run before
    now >= nextRun; // Past scheduled time
  
  if (shouldRun) {
    console.log('[LearningScheduler] Starting scheduled learning...');
    await runScheduledLearning();
  }
  
  await saveSchedulerState(state);
}

/**
 * تشغيل التعلم المجدول
 */
async function runScheduledLearning(): Promise<void> {
  const state = await loadSchedulerState();
  
  state.is_running = true;
  await saveSchedulerState(state);
  
  try {
    console.log('[LearningScheduler] Running weekly learning...');
    
    // Run learning with target 99%
    const progress = await startIntelligentLearning(99, 50);
    
    // Update state
    state.last_run = new Date().toISOString();
    state.last_win_rate = progress.best_win_rate;
    state.total_runs++;
    
    if (progress.best_win_rate > state.best_win_rate_ever) {
      state.best_win_rate_ever = progress.best_win_rate;
      
      // Save best parameters to database
      await saveBestParameters(progress);
    }
    
    console.log(`[LearningScheduler] Completed! Win rate: ${progress.best_win_rate.toFixed(2)}%`);
    
  } catch (error) {
    console.error('[LearningScheduler] Error:', error);
  } finally {
    state.is_running = false;
    await saveSchedulerState(state);
  }
}

/**
 * حفظ أفضل البارامترات في قاعدة البيانات
 *
 * Writes a new row into the `optimized_parameters` table in auth.db
 * (deactivates previous rows first) so that `recommendation-engine.ts`
 * can immediately pick up the new parameters via `getActiveParameters()`.
 */
async function saveBestParameters(progress: LearningProgress): Promise<void> {
  try {
    const { saveOptimizedParameters } = await import('./unified-prediction');
    const id = await saveOptimizedParameters(
      `Weekly-Schedule ${progress.best_win_rate.toFixed(1)}%`,
      progress.best_win_rate,
      progress.total_trades_analyzed,
      progress.best_parameters
    );
    console.log(`[LearningScheduler] Saved optimized parameters row: ${id} (win_rate=${progress.best_win_rate.toFixed(2)}%)`);
  } catch (error) {
    console.error('[LearningScheduler] Failed to save parameters:', error);
  }
}

// ==================== PUBLIC API ====================

/**
 * الحصول على حالة المجدول
 */
export async function getSchedulerStatus(): Promise<ScheduledLearningState> {
  return loadSchedulerState();
}

/**
 * تشغيل التعلم يدوياً
 */
export async function triggerManualLearning(): Promise<LearningProgress | null> {
  const state = await loadSchedulerState();
  
  if (state.is_running) {
    console.log('[LearningScheduler] Learning already in progress');
    return getIntelligentLearningProgress();
  }
  
  state.is_running = true;
  await saveSchedulerState(state);
  
  try {
    const progress = await startIntelligentLearning(99, 50);
    
    state.last_run = new Date().toISOString();
    state.last_win_rate = progress.best_win_rate;
    state.total_runs++;
    
    if (progress.best_win_rate > state.best_win_rate_ever) {
      state.best_win_rate_ever = progress.best_win_rate;
      // Persist the new best parameters to optimized_parameters table
      // so recommendation-engine picks them up via getActiveParameters().
      await saveBestParameters(progress);
    }
    
    return progress;
    
  } finally {
    state.is_running = false;
    await saveSchedulerState(state);
  }
}

/**
 * تفعيل/إيقاف التعلم التلقائي
 */
export async function setAutoLearning(enabled: boolean): Promise<void> {
  const state = await loadSchedulerState();
  state.auto_learning_enabled = enabled;
  await saveSchedulerState(state);
  
  console.log(`[LearningScheduler] Auto learning ${enabled ? 'enabled' : 'disabled'}`);
}

/**
 * تحديث جدول التعلم
 */
export async function updateLearningSchedule(day: number, hour: number): Promise<void> {
  const state = await loadSchedulerState();
  state.schedule_day = day;
  state.schedule_hour = hour;
  state.next_run = getNextRunTime(state).toISOString();
  await saveSchedulerState(state);
  
  console.log(`[LearningScheduler] Schedule updated: day ${day}, hour ${hour}`);
}
