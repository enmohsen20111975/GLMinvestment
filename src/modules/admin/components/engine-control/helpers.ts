/**
 * engine-control/helpers.ts
 * ========================
 * Pure helper functions for the Engine Control Room:
 * - timeAgoBrief: human-readable "منذ X د" Arabic relative time.
 * - statusTone: maps an engine status to a {dot, badge, label, bg} palette tuple.
 * - looksLikeError / severityOf: regex-based log line classification.
 * - downloadJson: triggers a client-side JSON file download.
 * - findCronJob: finds the most recent matching cron job by command pattern.
 * - nextRunCountdown: rough cron schedule countdown (Arabic, "بعد X ساعة").
 * - cronTone: cron-specific status tone (always "مجدول" unless just-triggered).
 *
 * Polling constants for the live log console:
 * - LIVE_LOG_POLL_MS (2s)
 * - LIVE_LOG_MAX_LINES (500)
 */
import type { CronHealthResponse, CronJob } from '@/hooks/useEngineControlRoomData';

export function timeAgoBrief(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return d.toLocaleString('ar-EG');
  if (diffMs < 60_000) return `منذ ${Math.floor(diffMs / 1000)} ث`;
  if (diffMs < 3_600_000) return `منذ ${Math.floor(diffMs / 60_000)} د`;
  if (diffMs < 86_400_000) return `منذ ${Math.floor(diffMs / 3_600_000)} س`;
  return `منذ ${Math.floor(diffMs / 86_400_000)} ي`;
}

export function statusTone(status: 'online' | 'offline' | 'degraded' | 'unknown' | 'running' | 'stopped' | 'slow' | 'scheduled') {
  switch (status) {
    case 'online':
    case 'running':
      return { dot: 'bg-profit', badge: 'border-profit text-profit', label: '🟢 يعمل', bg: 'bg-profit/20' };
    case 'scheduled':
      // Task 35-C: worker engines with no live process but a recent log entry
      // (last 30 min) → "🟢 مجدول" (emerald — it's a periodic worker, not dead).
      return { dot: 'bg-profit', badge: 'border-profit text-profit', label: '🟢 مجدول', bg: 'bg-profit/20' };
    case 'offline':
    case 'stopped':
      return { dot: 'bg-loss', badge: 'border-loss text-loss', label: '🔴 متوقف', bg: 'bg-loss/20' };
    case 'degraded':
    case 'slow':
      return { dot: 'bg-warning', badge: 'border-warning text-warning', label: '🟡 بطيء', bg: 'bg-warning/20' };
    default:
      return { dot: 'bg-slate-400', badge: 'border-slate-400 text-muted-foreground', label: '⚪ غير معروف', bg: 'bg-slate-50/20' };
  }
}

export function looksLikeError(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  return /\b(error|traceback|exception|fail|crash|denied|refused|timeout|unreachable|critical)\b/i.test(t);
}

export function severityOf(line: string): 'error' | 'warning' | 'info' {
  if (/\b(critical|traceback|exception|crash)\b/i.test(line)) return 'error';
  if (looksLikeError(line)) return 'warning';
  return 'info';
}

export function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Find the most recent cron job matching the given command pattern. */
export function findCronJob(cron: CronHealthResponse | null, pattern: string | undefined): CronJob | null {
  if (!cron?.jobs || !pattern) return null;
  // Match by substring (the command pattern e.g. 'daily_predictor.py' is a
  // substring of the cron entry's full_command).
  const matches = cron.jobs.filter(j => j.full_command.includes(pattern));
  if (matches.length === 0) return null;
  // Sort by last_run descending (most recent first).
  return matches.sort((a, b) => {
    const ta = a.last_run ? new Date(a.last_run).getTime() : 0;
    const tb = b.last_run ? new Date(b.last_run).getTime() : 0;
    return tb - ta;
  })[0];
}

/**
 * Compute the next-run countdown for a cron schedule.
 * Returns a human-readable Arabic string like "بعد 5 ساعات" or "بعد 2 دقيقة".
 * Returns '—' if the schedule is unparseable.
 *
 * NOTE: This is a *rough* countdown — it computes the next occurrence from now
 * using a minimal cron parser (minute/hour/day-of-week only — day-of-month and
 * month are ignored since our schedules are simple).
 */
export function nextRunCountdown(schedule: string): string {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return '—';
  const [minute, hour, , , dayOfWeek] = parts;
  const now = new Date();

  // Try the next 7 days × 24 hours × 60 minutes (≈ 10K iterations max).
  // Cheaper than a real cron parser and fine for a UI countdown.
  const maxAheadMs = 7 * 24 * 60 * 60 * 1000;
  const startMs = now.getTime();
  for (let t = startMs + 60_000; t < startMs + maxAheadMs; t += 60_000) {
    const d = new Date(t);
    // day-of-week check (cron: 0=Sun, JS: 0=Sun)
    if (dayOfWeek !== '*') {
      const dowRanges = dayOfWeek.split(',').flatMap(r => {
        if (r.includes('-')) {
          const [a, b] = r.split('-').map(n => parseInt(n, 10));
          return Array.from({ length: b - a + 1 }, (_, i) => a + i);
        }
        return [parseInt(r, 10)];
      });
      if (!dowRanges.includes(d.getDay())) continue;
    }
    // hour check
    if (hour !== '*') {
      const hours: number[] = [];
      if (hour.includes('-')) {
        const [a, b] = hour.split('-').map(n => parseInt(n, 10));
        for (let h = a; h <= b; h++) hours.push(h);
      } else if (hour.includes(',')) {
        hour.split(',').forEach(h => hours.push(parseInt(h, 10)));
      } else if (hour.startsWith('*/')) {
        const step = parseInt(hour.slice(2), 10);
        for (let h = 0; h < 24; h += step) hours.push(h);
      } else {
        hours.push(parseInt(hour, 10));
      }
      if (!hours.includes(d.getHours())) continue;
    }
    // minute check
    if (minute !== '*') {
      const minutes: number[] = [];
      if (minute.startsWith('*/')) {
        const step = parseInt(minute.slice(2), 10);
        for (let m = 0; m < 60; m += step) minutes.push(m);
      } else if (minute.includes(',')) {
        minute.split(',').forEach(m => minutes.push(parseInt(m, 10)));
      } else {
        minutes.push(parseInt(minute, 10));
      }
      if (!minutes.includes(d.getMinutes())) continue;
    }
    // Found the next run.
    const diffMs = t - startMs;
    if (diffMs < 60_000) return `بعد ${Math.floor(diffMs / 1000)} ثانية`;
    if (diffMs < 3_600_000) return `بعد ${Math.floor(diffMs / 60_000)} دقيقة`;
    if (diffMs < 86_400_000) return `بعد ${Math.floor(diffMs / 3_600_000)} ساعة`;
    return `بعد ${Math.floor(diffMs / 86_400_000)} يوم`;
  }
  return '—';
}

/** Tone specifically for cron engines — always "scheduled" (emerald) unless
 * the user just triggered a manual run (running = amber). */
export function cronTone(running: boolean) {
  if (running) {
    return { dot: 'bg-warning', badge: 'border-warning text-warning', label: '🟡 يعمل الآن', bg: 'bg-warning/20' };
  }
  // CRITICAL Rule 67 fix: cron engines are NEVER "متوقف" — they're "مجدول".
  return { dot: 'bg-profit', badge: 'border-profit text-profit', label: '🟢 مجدول', bg: 'bg-profit/20' };
}

/** Live log console polling constants (Task 33 Phase 5). */
export const LIVE_LOG_POLL_MS = 2000;
export const LIVE_LOG_MAX_LINES = 500;
