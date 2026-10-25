/**
 * GET /api/admin/cron-health
 * =========================
 * Task 28-B (Fix 4 — Fix Battalion):
 *   Returns all cron jobs declared in crontab.txt (25 jobs) + their
 *   last_run timestamp (when available from /tmp/*.log files).
 *
 *   Reads:
 *     - /home/z/my-project/crontab.txt  → parses the 25 cron jobs
 *     - /tmp/*.log                       → stat() mtime for each log file
 *
 *   Rule 20: read-only — just stat + parse, no Python invocation.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { access, readFile, stat } from 'fs/promises';
import { join } from 'path';

export const dynamic = 'force-dynamic';

interface CronJob {
  id: number;            // sequential index for display
  schedule: string;      // the cron expression (5 fields)
  schedule_human: string;// Arabic human-readable schedule
  command: string;       // the command (truncated for display)
  full_command: string;  // the full command
  log_file: string | null;      // /tmp/...log path extracted from the command
  last_run: string | null;      // mtime of the log file
  last_run_human: string | null;// "منذ X دقيقة" / date string
  days_ar: string;       // "الأحد-الخميس" / "أسبوعياً" / "يومياً"
  description: string;   // first comment line above the cron entry
  category: string;      // "توقعات" / "أسعار" / "أخبار" / "نسخ احتياطي" ...
  exists_log: boolean;
}

const CRONTAB_PATH = join(process.cwd(), 'crontab.txt');

// Map of log filename → category for nicer grouping
function categorize(logFile: string | null, description: string): string {
  if (!logFile) return 'عام';
  if (logFile.includes('v40_2') || logFile.includes('daily_predictor')) return 'توقعات V40.2';
  if (logFile.includes('intraday')) return 'فحص لحظي';
  if (logFile.includes('daily_closer') || logFile.includes('post_market')) return 'إغلاق الصفقات';
  if (logFile.includes('learning')) return 'تعلّم';
  if (logFile.includes('corporate') || logFile.includes('disclosures')) return 'أساسيات + إفصاحات';
  if (logFile.includes('price_updater') || logFile.includes('price_safetynet')) return 'تحديث الأسعار';
  if (logFile.includes('tradingview') || logFile.includes('multi_scraper') || logFile.includes('us_scraper')) return 'سكرابرز';
  if (logFile.includes('heartbeat')) return 'صحة DB';
  if (logFile.includes('backup')) return 'نسخ احتياطي';
  if (logFile.includes('fundamentals')) return 'أساسيات أسبوعية';
  if (logFile.includes('sync_hunter') || logFile.includes('radar_signal')) return 'رادار';
  if (logFile.includes('regime')) return 'حالة السوق';
  if (logFile.includes('weekly_report') || logFile.includes('telegram_report')) return 'تقارير';
  if (logFile.includes('sharia')) return 'فحص شرعي';
  if (logFile.includes('downgrade_expired')) return 'اشتراكات';
  if (logFile.includes('exit_optimizer') || logFile.includes('learned_lessons')) return 'تحسين سياسة الخروج';
  if (logFile.includes('hot_candidate')) return 'اكتشاف أسهم ساخنة';
  return 'عام';
}

function describeSchedule(schedule: string): { human: string; days: string } {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return { human: schedule, days: '—' };

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const dowNames = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

  // Determine days of week
  let days = 'يومياً';
  if (dayOfWeek === '0-4') days = 'الأحد-الخميس (أيام التداول)';
  else if (dayOfWeek === '1-5') days = 'الإثنين-الجمعة';
  else if (dayOfWeek === '6') days = 'السبت';
  else if (dayOfWeek === '0') days = 'الأحد';
  else if (dayOfWeek === '*') days = 'يومياً';

  // Build human-readable schedule
  let human = '';
  if (minute.startsWith('*/')) {
    human = `كل ${minute.slice(2)} دقيقة`;
  } else if (minute === '0' && hour.includes('-')) {
    human = `كل ساعة من ${hour.split('-')[0]}:00 إلى ${hour.split('-')[1]}:00 UTC`;
  } else if (minute === '0') {
    human = `يومياً ${hour.padStart(2, '0')}:${minute.padStart(2, '0')} UTC`;
  } else {
    human = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')} UTC`;
  }

  return { human, days };
}

function timeAgo(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return d.toLocaleString('ar-EG');
  if (diffMs < 60_000) return `منذ ${Math.floor(diffMs / 1000)} ثانية`;
  if (diffMs < 3_600_000) return `منذ ${Math.floor(diffMs / 60_000)} دقيقة`;
  if (diffMs < 86_400_000) return `منذ ${Math.floor(diffMs / 3_600_000)} ساعة`;
  return `منذ ${Math.floor(diffMs / 86_400_000)} يوم`;
}

// Extract /tmp/foo.log from a command line
function extractLogFile(cmd: string): string | null {
  const match = cmd.match(/>>?\s*(\/tmp\/[^\s|;&]+\.log)/);
  return match ? match[1] : null;
}

export async function GET(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  try {
    try {
      await access(CRONTAB_PATH);
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: 'crontab_missing',
          path: CRONTAB_PATH,
          hint: 'crontab.txt is missing from project root',
        },
        { status: 404 },
      );
    }

    const raw = await readFile(CRONTAB_PATH, 'utf-8');
    const lines = raw.split('\n');

    const jobs: CronJob[] = [];
    let pendingDescription = '';
    let jobIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      // Skip empty lines
      if (!line) {
        pendingDescription = '';
        continue;
      }
      // Comment line — stash it as the next job's description
      if (line.startsWith('#')) {
        // Use the first comment line we encounter
        if (!pendingDescription && line.length > 1) {
          pendingDescription = line.replace(/^#\s*/, '');
        }
        continue;
      }

      // Try to parse as a cron entry. A cron entry has 5 fields then the
      // command. The 5 fields are: minute hour day-of-month month day-of-week
      const parts = line.split(/\s+/);
      if (parts.length < 6) continue;
      const schedule = parts.slice(0, 5).join(' ');
      const cmd = parts.slice(5).join(' ');

      // Validate the schedule looks like a cron expression
      if (!/^[\d*/,-]+\s+[\d*/,-]+\s+[\d*/,-]+\s+[\d*/,-]+\s+[\d*/,-]+$/.test(schedule)) {
        // Not a cron entry — skip
        pendingDescription = '';
        continue;
      }

      jobIndex++;
      const logFile = extractLogFile(cmd);
      const { human, days } = describeSchedule(schedule);

      let lastRun: string | null = null;
      let lastRunHuman: string | null = null;
      let existsLog = false;

      if (logFile) {
        try {
          const st = await stat(logFile);
          existsLog = true;
          lastRun = st.mtime.toISOString();
          lastRunHuman = timeAgo(lastRun);
        } catch {
          // Log file doesn't exist (cron never ran or log was rotated)
          existsLog = false;
        }
      }

      jobs.push({
        id: jobIndex,
        schedule,
        schedule_human: human,
        days_ar: days,
        command: cmd.length > 80 ? cmd.slice(0, 80) + '...' : cmd,
        full_command: cmd,
        log_file: logFile,
        last_run: lastRun,
        last_run_human: lastRunHuman,
        exists_log: existsLog,
        description: pendingDescription || '(لا يوجد وصف)',
        category: categorize(logFile, pendingDescription),
      });

      pendingDescription = '';
    }

    // Summary stats
    const totalJobs = jobs.length;
    const jobsRan = jobs.filter(j => j.exists_log).length;
    const jobsNeverRun = jobs.filter(j => !j.exists_log).length;
    const jobsRunToday = jobs.filter(j => {
      if (!j.last_run) return false;
      const d = new Date(j.last_run);
      return (Date.now() - d.getTime()) < 24 * 60 * 60 * 1000;
    }).length;
    const jobsStale = jobs.filter(j => {
      if (!j.last_run) return false;
      const d = new Date(j.last_run);
      const ageDays = (Date.now() - d.getTime()) / (24 * 60 * 60 * 1000);
      return ageDays > 7;
    }).length;

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      source: 'crontab.txt',
      summary: {
        total_jobs: totalJobs,
        jobs_ran: jobsRan,
        jobs_never_run: jobsNeverRun,
        jobs_run_today: jobsRunToday,
        jobs_stale_7d: jobsStale,
      },
      jobs,
    });
  } catch (err) {
    console.error('[GET /api/admin/cron-health]', err);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
