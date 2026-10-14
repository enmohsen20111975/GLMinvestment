/**
 * GET /api/maker-radar/timeline?ticker=COMI&days=60
 * ==================================================
 * CANONICAL signal-tracking timeline route — pure Python proxy with honest empty.
 *
 * Directive P1 (API Routes Decoupling): this route previously opened TWO
 * databases directly:
 *   1. `@/modules/radar/lib/radar-db` (getRadarDb / getRadarDbConfig) — opens
 *      `db/stocks.db` / `db/data_engine.db` to read price history rows.
 *   2. `db/predictions.db` (new Database(...)) — to read latest prediction
 *      target/stop_loss AND to read signal events from radar_signal_tracking.
 * Both bypassed the canonical Python engine. Now this route:
 *   1. Proxies to Python `/api/maker-radar/timeline?ticker=X&days=Y` (primary).
 *   2. Falls back to the local tracking JSON only (entry date + entry price) —
 *      but returns honest empty timeline / milestones / prediction when
 *      Python is unreachable (Rule 27 NO-FAKE-DATA — no fabricated prices).
 *
 * Rule 4 (Python = brain, Frontend = mirror only).
 * Rule 27 (NO-FAKE-DATA).
 */
import { NextRequest, NextResponse } from 'next/server';
import { readFile, access } from 'fs/promises';
import path from 'path';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Signal Tracking Timeline API
 * =============================
 *
 * GET /api/maker-radar/timeline?ticker=COMI&days=30
 *
 * Returns the journey of a tracked stock from the moment it entered the
 * radar until now — entry price, current price, target progress, milestone
 * events, and a checklist of "did this happen yet" milestones.
 *
 * Data sources (Python is canonical; local tracking JSON is a thin
 * server-side cache of which tickers the user is tracking):
 *   - db/maker_radar_tracking.json — entry date + entry price (REQUIRED local)
 *   - Python /api/maker-radar/timeline — daily prices, prediction, signals
 *
 * If the stock is not tracked OR Python is unreachable, returns success=false
 * with a helpful Arabic error message so the component can render the
 * appropriate empty / CTA state (Rule 27).
 */

const PROJECT_ROOT = process.cwd();
const TRACKING_FILE = path.join(PROJECT_ROOT, 'db', 'maker_radar_tracking.json');

interface TrackedStock {
  ticker: string;
  entryDate: string;
  entryPrice: number;
  addedAt: string;
  notes?: string;
}

async function loadTracking(): Promise<Record<string, TrackedStock>> {
  try {
    try {
      await access(TRACKING_FILE);
    } catch { // silent fallback (safe-by-design)
      return {};
    }
    const data = await readFile(TRACKING_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    console.error('[maker-radar/timeline] load tracking error:', e);
    return {};
  }
}

function round2(v: number): number {
  if (!isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET handler
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const ticker = (url.searchParams.get('ticker') || '').toUpperCase().trim();
  const days = Math.max(1, parseInt(url.searchParams.get('days') || '60', 10));

  if (!ticker) {
    return NextResponse.json(
      { success: false, error: 'ticker query param is required' },
      { status: 400 },
    );
  }

  // 1. Load local tracking JSON (server-side cache — NOT a DB open)
  const tracking = await loadTracking();
  const tracked = tracking[ticker];

  if (!tracked) {
    return NextResponse.json({
      success: false,
      not_tracked: true,
      ticker,
      error: 'السهم غير متابَع — أضِفه إلى قائمة المتابعة لعرض الخط الزمني',
    });
  }

  if (!tracked.entryPrice || tracked.entryPrice <= 0) {
    return NextResponse.json({
      success: false,
      ticker,
      entry_price_missing: true,
      error: 'سعر الدخول مش متسجل',
      entry: { date: tracked.entryDate, price: 0 },
    });
  }

  // ─── 2. PRIMARY: Python canonical endpoint ────────────────────────────────
  const qs = `ticker=${encodeURIComponent(ticker)}&days=${encodeURIComponent(String(days))}`;
  const targetUrls = [
    `${PYTHON_BACKEND_URL}/api/maker-radar/timeline?${qs}`,
    `http://127.0.0.1:8010/api/maker-radar/timeline?${qs}`,
  ];

  for (const targetUrl of targetUrls) {
    try {
      const res = await fetch(targetUrl, {
        signal: AbortSignal.timeout(9000),
        cache: 'no-store',
      });
      if (res.ok) {
        const json = await res.json();
        if (json && json.success === true && (json.timeline || json.current)) {
          // Pass through Python response verbatim (Rule 4: mirror only).
          return NextResponse.json({
            ...json,
            ticker,
            entry: json.entry ?? { date: tracked.entryDate, price: round2(tracked.entryPrice) },
            source: 'python',
          });
        }
      }
    } catch { // silent fallback (safe-by-design)
    }
  }

  // ─── 3. FALLBACK: honest empty (Rule 27 NO-FAKE-DATA) ────────────────────
  // Python (the canonical source for prices + predictions + signal events) is
  // unreachable. We MUST NOT fabricate prices / milestones / predictions.
  // Return the entry info (we have it locally) plus explicit nulls so the
  // consumer UI can render an honest "data missing" state.
  return NextResponse.json({
    success: false,
    ticker,
    no_price_history: true,
    error: 'مفيش بيانات أسعار كافية بعد — المحرك الكنسي مش متاح',
    entry: { date: tracked.entryDate, price: round2(tracked.entryPrice) },
    current: null,
    target_1: { price: null, pct: null, status: 'data_missing', progress_pct: null },
    target_2: { price: null, pct: null, status: 'data_missing', progress_pct: null },
    stop_loss: { price: null, pct: null, status: 'data_missing', progress_pct: null },
    timeline: [],
    milestones: [],
    prediction: null,
    signal_events_count: 0,
    price_points: 0,
    fallback: true,
    computed_at: new Date().toISOString(),
  });
}
