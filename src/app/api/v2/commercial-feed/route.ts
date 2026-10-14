<<<<<<< HEAD
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
=======
import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const fs = require('fs');
const path = require('path');
const PREDICTIONS_DB = path.join(process.cwd(), 'db', 'predictions.db');
const STOCKS_DB = path.join(process.cwd(), 'db', 'stocks.db');

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const market = (url.searchParams.get('market') || 'EGX').replace(/[^A-Za-z]/g, '').toUpperCase();
  if (!fs.existsSync(PREDICTIONS_DB)) {
    return NextResponse.json({ success: false, error: 'predictions_db_not_found', message: 'قاعدة بيانات التوقعات غير متاحة (Rule 27)', active_live_signals: [], audited_performance: [], stats: { live_count: 0, audited_count: 0, win_rate: null, avg_return: null } }, { status: 503 });
  }
  try {
    const Database = require('better-sqlite3');
    const db = new Database(PREDICTIONS_DB, { readonly: true });
    let stocksAttached = false;
    try { if (fs.existsSync(STOCKS_DB)) { db.exec(`ATTACH DATABASE '${STOCKS_DB}' AS stocks_db`); stocksAttached = true; } } catch {}
    const marketFilter = market !== 'ALL' ? `AND (p.market = '${market}' OR p.market IS NULL)` : '';
    const liveQuery = stocksAttached
      ? `SELECT p.ticker, s.name_ar, s.sector, p.market, p.signal, p.signal_ar, p.entry_price, p.target_price, p.target_price_2, p.stop_loss, p.risk_reward, p.confidence, p.master_score, p.persona, p.prediction_date, s.current_price, p.analysis_reason, p.who_is_buying FROM predictions p LEFT JOIN stocks_db.stocks s ON UPPER(p.ticker) = UPPER(s.ticker) WHERE (p.status IN ('active','ACTIVE','pending','PENDING') OR p.status IS NULL) AND UPPER(p.signal) IN ('BUY','STRONG_BUY','ACCUMULATE') ${marketFilter} ORDER BY p.confidence DESC, p.master_score DESC LIMIT 12`
      : `SELECT ticker, NULL as name_ar, NULL as sector, market, signal, signal_ar, entry_price, target_price, target_price_2, stop_loss, risk_reward, confidence, master_score, persona, prediction_date, NULL as current_price, analysis_reason, who_is_buying FROM predictions WHERE (status IN ('active','ACTIVE','pending','PENDING') OR status IS NULL) AND UPPER(signal) IN ('BUY','STRONG_BUY','ACCUMULATE') ${marketFilter} ORDER BY confidence DESC, master_score DESC LIMIT 12`;
    const liveRows = db.prepare(liveQuery).all();
    const liveSignals = liveRows.map((r: any) => {
      const entry = Number(r.entry_price) || 0;
      const target = Number(r.target_price) || 0;
      const stop = Number(r.stop_loss) || 0;
      const upside_pct = entry > 0 && target > 0 ? Math.round(((target - entry) / entry) * 10000) / 100 : null;
      const downside_pct = entry > 0 && stop > 0 ? Math.round(((stop - entry) / entry) * 10000) / 100 : null;
      const rawReason = r.analysis_reason || null;
      const catalyst = rawReason || r.who_is_buying || null;
      return { ...r, current_price: r.current_price ? Number(r.current_price) : (entry || null), upside_pct, downside_pct, catalyst, analysis_reason: rawReason };
    });
    const auditedQuery = `SELECT ticker, signal, signal_ar, entry_price, target_price, stop_loss, exit_price, actual_return, pnl_pct, pnl_percent, hit_target, hit_stop, holding_days, market, prediction_date, closed_at FROM predictions WHERE status IN ('closed','CLOSED','expired','EXPIRED','target_hit','stop_hit') OR closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT 50`;
    const auditedRows = db.prepare(auditedQuery).all();
    const auditedPerformance = auditedRows.filter((r: any) => (Number(r.entry_price) || 0) > 0).map((r: any) => ({
      ...r, actual_return: r.actual_return != null ? Number(r.actual_return) : (r.pnl_pct != null ? Number(r.pnl_pct) : null),
      hit_target: r.hit_target != null ? Number(r.hit_target) : null, hit_stop: r.hit_stop != null ? Number(r.hit_stop) : null, holding_days: r.holding_days != null ? Number(r.holding_days) : null,
    }));
    db.close();
    const winRate = auditedPerformance.length > 0 ? Math.round((auditedPerformance.filter((t: any) => t.hit_target === 1).length / auditedPerformance.length) * 1000) / 10 : null;
    const avgReturn = auditedPerformance.length > 0 ? Math.round((auditedPerformance.reduce((s: number, t: any) => s + (Number(t.actual_return) || 0), 0) / auditedPerformance.length) * 100) / 100 : null;
    return NextResponse.json({ success: true, market, active_live_signals: liveSignals, audited_performance: auditedPerformance, stats: { live_count: liveSignals.length, audited_count: auditedPerformance.length, win_rate: winRate, avg_return: avgReturn } });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'commercial_feed_error', message: error instanceof Error ? error.message : 'خطأ غير معروف', active_live_signals: [], audited_performance: [], stats: { live_count: 0, audited_count: 0, win_rate: null, avg_return: null } }, { status: 500 });
>>>>>>> 0a55727 (feat(ui): A-18: Null safety + unified Arabic tabs + English purge)
  }
}
