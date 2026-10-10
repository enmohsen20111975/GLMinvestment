/**
 * GET /api/market/exit-status?limit=20&ticker=COMI
 *
 * P41 Exit Engine — حالة الخروج اللحظي للتوقاعات النشطة.
 * Primary: Python /api/market/exit-status.
 * Fallback (FLUTTER-FULL-AUDIT): predictions.db — return active predictions
 *   with their current exit_status derived from DB columns. Previously
 *   returned 503 when Python was unreachable.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPredictionsFallback } from '@/lib/flutter-sqlite-fallback';
import { computeRiskReward } from '@/lib/risk-reward';

export const dynamic = 'force-dynamic';

const PYTHON_BACKEND =
  process.env.PYTHON_BACKEND_URL ||
  process.env.VPS_API_URL ||
  process.env.EGXPY_SERVICE_URL ||
  'http://127.0.0.1:8010';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const params = new URLSearchParams();
  const limit = searchParams.get('limit') || '20';
  const ticker = searchParams.get('ticker');
  params.set('limit', limit);
  if (ticker) params.set('ticker', ticker.toUpperCase());

  const backendUrl = `${PYTHON_BACKEND.replace(/\/$/, '')}/api/market/exit-status?${params.toString()}`;

  // 1. Try Python
  try {
    const response = await fetch(backendUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });

    if (response.ok) {
      const data = await response.json();
      return NextResponse.json(data, {
        headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
      });
    }
  } catch { // silent fallback (safe-by-design)
    // fall through
  }

  // 2. SQLite fallback — predictions.db active predictions
  const preds = getPredictionsFallback(parseInt(limit, 10), 'active');
  const filtered = ticker
    ? preds.filter(
        (p) => String(p.ticker).toUpperCase() === ticker.toUpperCase()
      )
    : preds;

  const exitStatuses = filtered.map((p) => {
    const entry = Number(p.entry_price) || 0;
    const target = Number(p.target_price) || 0;
    const stop = Number(p.stop_loss) || 0;
    const direction = String(p.direction || p.signal || '').toUpperCase();
    const isLong = direction.includes('BUY') || direction.includes('LONG') || direction.includes('UP');
    return {
      ticker: p.ticker,
      signal: p.signal,
      signal_ar: p.signal_ar,
      direction: p.direction || (isLong ? 'LONG' : 'SHORT'),
      entry_price: entry,
      target_price: target,
      stop_loss: stop,
      risk_reward: p.risk_reward || computeRiskReward(entry, target, stop),
      status: p.status || 'active',
      // P0-6 FIX (RADAR-AUDIT-TS B24): لا نخترع 'HOLD' (Rule 27 NO-FAKE-DATA).
      // exit_status اللحظي يحتاج Python backend لحساب hit_target/trailing/stop
      // بدقة. عند فشل Python، نرجع null + ملاحظة واضحة بدل fabrication.
      exit_status: null,
      exit_reason: null,
      exit_note: 'حالة الخروج اللحظي غير متاحة — Python backend غير متاح. القيم الأساسية (دخول/هدف/وقف) صحيحة من predictions.db.',
      prediction_date: p.prediction_date,
      persona: p.persona,
      master_score: p.master_score,
    };
  });

  return NextResponse.json({
    success: true,
    source: 'sqlite_fallback',
    fallback_mode: true, // مؤشر للواجهة أن exit_status غير محسوب
    exits: exitStatuses,
    data: exitStatuses,
    count: exitStatuses.length,
    timestamp: new Date().toISOString(),
  });
}
