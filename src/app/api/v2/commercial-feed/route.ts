import { NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

const execFileAsync = promisify(execFile);

/**
 * GET /api/v2/commercial-feed
 * ==========================
 * الـ Single Commercial Feed الموحد للمنصة (Task B-18).
 *
 * المصدر الواحد للحقيقة (SSOT): db/stocks.db.predictions
 * العقل: Python (scripts/commercial_feed.py) — Rule 20 (PYTHON=BRAIN)
 *
 * يرجع JSON نضيف فيه:
 *   - active_live_signals: الصفقات الشغالة حاليًا (entry/target/stop/horizon)
 *   - audited_performance_history: سجل الأداء الموثق
 *   - summary: إحصائيات (win_rate, avg_rr, profit_factor, ...)
 *
 * الكاش: 30 ثانية في الذاكرة لتقليل spawn Python على كل طلب.
 * Rule 27 (NO-FAKE-DATA): لا fabricate أي بيانات — لو Python فشل، نرجع
 * structured empty result مع رسالة واضحة.
 *
 * Task B-17 refactor (2026-10-14): commercial_feed.py يعمل ATTACH DATABASE
 * لـ stocks.db على predictions.db (لو موجود) أو يفتح stocks.db مباشرة.
 * stderr نظيف — لا أخطاء "no such table: stocks".
 */
const CACHE_TTL_MS = 30_000; // 30 ثانية
const cachedPayloads: Record<string, { data: unknown; ts: number }> = {};

const SCRIPT_PATH = path.join(process.cwd(), 'scripts', 'commercial_feed.py');
const PROJECT_ROOT = process.cwd();

export async function GET(req: Request) {
  // 1. استخراج السوق المطلوب بدقة
  const { searchParams } = new URL(req.url);
  const rawMarket = searchParams.get('market') || 'EGX';
  const market = rawMarket.trim().toUpperCase();

  // 2. تحقق من الكاش الخاص بهذا السوق
  const cached = cachedPayloads[market];
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return NextResponse.json(cached.data, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'X-Commercial-Feed-Source': 'memory-cache',
        'X-Commercial-Feed-Market': market,
      },
    });
  }

  // 3. تحقق إن السكريبت موجود
  if (!fs.existsSync(SCRIPT_PATH)) {
    return NextResponse.json(
      {
        success: false,
        error: 'commercial_feed.py script not found',
        path: SCRIPT_PATH,
        active_live_signals: [],
        audited_performance_history: [],
        summary: null,
      },
      { status: 500 }
    );
  }

  // 4. نفّذ Python (العقل) مع timeout 10 ثواني وعزل السوق
  try {
    const { stdout } = await execFileAsync(
      'python3',
      [SCRIPT_PATH, '--json', '--market', market],
      {
        cwd: PROJECT_ROOT,
        timeout: 10_000,
        maxBuffer: 5 * 1024 * 1024, // 5MB
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
      }
    );

    // 5. parse JSON output
    let data: unknown;
    try {
      data = JSON.parse(stdout);
    } catch (parseErr) {
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to parse commercial_feed.py output',
          raw_stdout_preview: stdout.slice(0, 500),
          active_live_signals: [],
          audited_performance_history: [],
          summary: null,
        },
        { status: 502 }
      );
    }

    // 6. خزّن في الكاش الخاص بالسوق
    cachedPayloads[market] = { data, ts: Date.now() };

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'X-Commercial-Feed-Source': 'python-live',
        'X-Commercial-Feed-Market': market,
      },
    });
  } catch (err: unknown) {
    // Python فشل (timeout / crash / etc) — لا fabricate بيانات
    const error = err as { code?: string; message?: string; signal?: string; stderr?: string };
    const isTimeout = error?.signal === 'SIGTERM' || error?.code === 'ETIMEDOUT';

    return NextResponse.json(
      {
        success: false,
        error: isTimeout ? 'commercial_feed.py timed out (>10s)' : 'commercial_feed.py failed',
        message: error?.message || 'Unknown error',
        stderr_preview: error?.stderr ? error.stderr.slice(0, 500) : undefined,
        active_live_signals: [],
        audited_performance_history: [],
        summary: {
          active_signals: { count: 0, avg_rr: 0, avg_confidence: 0 },
          audited_performance: {
            total_closed: 0,
            wins: 0,
            losses: 0,
            expired: 0,
            win_rate: 0,
            avg_return: 0,
            best_return: 0,
            worst_return: 0,
            profit_factor: 0,
          },
          generated_at: new Date().toISOString(),
        },
        note: 'Python backend unavailable — returning empty structured result (NO-FAKE-DATA).',
      },
      {
        status: 200, // 200 عشان الـ frontend ما يكسرش، بس success=false
        headers: {
          'Cache-Control': 'no-store, max-age=0',
          'X-Commercial-Feed-Source': 'python-failed-fallback',
        },
      }
    );
  }
}
