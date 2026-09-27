import { NextRequest, NextResponse } from 'next/server';
import {
  getRadarDb,
  getRadarDbConfig,
  parseVolume,
  computeTurnover,
  type RadarDbConfig,
} from '@/lib/radar-db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/maker-radar/entry-timing?ticker=COMI
 *
 * Entry-timing score (0-100) for a ticker based on last 30 trading days.
 * Reads from the same radar DB (egksco_price_history or fallbacks).
 *
 * Score breakdown:
 *   1. Accumulation Strength (0-30) — buy days in last 10 sessions
 *   2. Volume Confirmation  (0-25) — vol_ratio = avg10d / avg20d
 *   3. Price Near Support    (0-25) — distance from 20-day low
 *   4. Momentum ROC10       (0-20) — 10-day rate of change
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const ticker = (url.searchParams.get('ticker') || '').toUpperCase().trim();

  if (!ticker) {
    return NextResponse.json(
      { success: false, error: 'ticker query param is required' },
      { status: 400 }
    );
  }

  const cfg = getRadarDbConfig();
  const db = getRadarDb();
  if (!cfg || !db) {
    return NextResponse.json(
      {
        success: false,
        error:
          'No radar DB available. Run scripts/fetch_production_data.py on sandbox, or ensure db/stocks.db exists on production.',
      },
      { status: 503 }
    );
  }

  try {
    const prices = fetchLast30Days(db, cfg, ticker);

    if (prices.length < 15) {
      db.close();
      return NextResponse.json({
        success: false,
        error: `بيانات غير كافية للسهم ${ticker} — تم العثور على ${prices.length} جلسة فقط (المطلوب 15 على الأقل)`,
        ticker,
        data_points: prices.length,
      });
    }

    // ── 1. Accumulation Strength (0-30) ────────────────────────────────
    // Count buy days in last 10 sessions (close > prev_close).
    // Use the day-before-window for the first session so max possible = 10.
    let buyDays = 0;
    const window = prices.slice(-10);
    let prevClose = prices.length > 10 ? prices[prices.length - 11].close : window[0].close;
    for (const p of window) {
      if (p.close > prevClose) buyDays++;
      prevClose = p.close;
    }

    let accScore: number;
    let accLabel: string;
    if (buyDays >= 8) { accScore = 30; accLabel = 'تجميع قوي جداً'; }
    else if (buyDays >= 6) { accScore = 22; accLabel = 'تجميع قوي'; }
    else if (buyDays >= 5) { accScore = 15; accLabel = 'تجميع معتدل'; }
    else if (buyDays >= 3) { accScore = 8; accLabel = 'تجميع ضعيف'; }
    else { accScore = 0; accLabel = 'لا يوجد تجميع'; }
    const accDetail = `${buyDays} من 10 أيام شراء`;

    // ── 2. Volume Confirmation (0-25) ───────────────────────────────────
    const volumes = prices.map((p) => p.volume).filter((v) => v > 0);
    const avgVol10 =
      volumes.length >= 10
        ? volumes.slice(-10).reduce((a, b) => a + b, 0) / 10
        : volumes.reduce((a, b) => a + b, 0) / Math.max(volumes.length, 1);
    const avgVol20 =
      volumes.length >= 20
        ? volumes.slice(-20).reduce((a, b) => a + b, 0) / 20
        : volumes.reduce((a, b) => a + b, 0) / Math.max(volumes.length, 1);
    const volRatio = avgVol20 > 0 ? avgVol10 / avgVol20 : 0;

    let volScore: number;
    let volLabel: string;
    if (volRatio >= 1.5) { volScore = 25; volLabel = 'حجم مؤكد بقوة'; }
    else if (volRatio >= 1.2) { volScore = 18; volLabel = 'حجم مؤكد'; }
    else if (volRatio >= 1.0) { volScore = 10; volLabel = 'حجم متوسط'; }
    else { volScore = 0; volLabel = 'حجم ضعيف'; }
    const volDetail = `نسبة الحجم ${round2(volRatio)}`;

    // ── 3. Price Near Support (0-25) ────────────────────────────────────
    const closes = prices.map((p) => p.close).filter((c) => c > 0);
    const current = closes[closes.length - 1];
    const last20closes = closes.slice(-20);
    const min20 = last20closes.length > 0 ? Math.min(...last20closes) : current;
    const distanceFromMin = min20 > 0 ? ((current - min20) / min20) * 100 : 0;

    let supScore: number;
    let supLabel: string;
    if (distanceFromMin <= 2) { supScore = 25; supLabel = 'قرب الدعم مباشرة'; }
    else if (distanceFromMin <= 5) { supScore = 18; supLabel = 'قرب الدعم'; }
    else if (distanceFromMin <= 10) { supScore = 10; supLabel = 'متوسط البعد عن الدعم'; }
    else { supScore = 0; supLabel = 'بعيد عن الدعم'; }
    const supDetail = `${round2(distanceFromMin)}% من قاع 20 يوم`;

    // ── 4. Momentum ROC10 (0-20) ────────────────────────────────────────
    const roc10 =
      closes.length >= 11 && closes[closes.length - 11] > 0
        ? ((closes[closes.length - 1] - closes[closes.length - 11]) /
            closes[closes.length - 11]) *
          100
        : 0;

    let momScore: number;
    let momLabel: string;
    if (roc10 >= 5 && roc10 <= 15) { momScore = 20; momLabel = 'زخم مثالي'; }
    else if (roc10 >= 0 && roc10 < 5) { momScore = 12; momLabel = 'زخم موجب خفيف'; }
    else if (roc10 > 15 && roc10 <= 25) { momScore = 14; momLabel = 'زخم معتدل'; }
    else if (roc10 >= -5 && roc10 < 0) { momScore = 6; momLabel = 'زخم سلبي خفيف'; }
    else { momScore = 0; momLabel = roc10 < -5 ? 'زخم سلبي قوي' : 'زخم مفرط (خطير)'; }
    const momDetail = `ROC 10 أيام = ${round2(roc10)}%`;

    // ── Final score + label ─────────────────────────────────────────────
    const score = accScore + volScore + supScore + momScore;

    let label: string;
    let labelColor: string;
    if (score >= 80) { label = 'توقيت ممتاز'; labelColor = 'emerald'; }
    else if (score >= 60) { label = 'توقيت جيد'; labelColor = 'amber'; }
    else if (score >= 40) { label = 'توقيت مقبول'; labelColor = 'yellow'; }
    else { label = 'توقيت ضعيف'; labelColor = 'rose'; }

    const recommendation = buildRecommendation(
      score,
      distanceFromMin,
      min20,
      volRatio
    );

    db.close();

    return NextResponse.json({
      success: true,
      ticker,
      score,
      label,
      label_color: labelColor,
      breakdown: {
        accumulation: { score: accScore, max: 30, label: accLabel, detail: accDetail },
        volume: { score: volScore, max: 25, label: volLabel, detail: volDetail },
        support: { score: supScore, max: 25, label: supLabel, detail: supDetail },
        momentum: { score: momScore, max: 20, label: momLabel, detail: momDetail },
      },
      recommendation,
      data_points: prices.length,
      current_price: round2(current),
      min_20: round2(min20),
      vol_ratio: round2(volRatio),
      roc_10d: round2(roc10),
      buy_days_10: buyDays,
      computed_at: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[maker-radar/entry-timing] error:', error);
    try { db.close(); } catch {}
    return NextResponse.json(
      { success: false, error: error?.message || 'Internal error' },
      { status: 500 }
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

interface PriceRow {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
}

function fetchLast30Days(
  db: any,
  cfg: RadarDbConfig,
  ticker: string
): PriceRow[] {
  const cols = `${cfg.dateCol}, ${cfg.openCol} AS open, ${cfg.highCol} AS high, ${cfg.lowCol} AS low, ${cfg.priceCol} AS close, ${cfg.volumeCol} AS volume`;
  const turnoverSelect = cfg.turnoverCol
    ? `, ${cfg.turnoverCol} AS turnover`
    : `, NULL AS turnover`;
  const rows = db
    .prepare(
      `SELECT ${cols}${turnoverSelect}
       FROM ${cfg.table}
       WHERE ${cfg.tickerCol} = ? AND ${cfg.priceCol} IS NOT NULL AND ${cfg.priceCol} > 0
       ORDER BY ${cfg.dateCol} DESC
       LIMIT 30`
    )
    .all(ticker) as any[];

  return rows.reverse().map((r) => ({
    date: String(r[cfg.dateCol]),
    open: num(r.open),
    high: num(r.high),
    low: num(r.low),
    close: num(r.close),
    volume: parseVolume(r.volume),
    turnover: computeTurnover(r, cfg),
  }));
}

function num(v: any): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return isNaN(n) ? 0 : n;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function buildRecommendation(
  score: number,
  distanceFromMin: number,
  min20: number,
  volRatio: number
): string {
  if (score >= 80) {
    return `مدخل قوي وممتاز — يُفضّل التجميع تدريجياً مع وقف محكم تحت ${round2(min20)} (قاع 20 يوم)`;
  }
  if (score >= 60) {
    if (distanceFromMin <= 5) {
      return `مدخل مناسب قرب الدعم مع وقف محكم تحت ${round2(min20)} — نسبة الحجم ${round2(volRatio)}`;
    }
    return `مدخل مناسب مع وقف محكم تحت آخر قاع — يحتاج تأكيد اختراق`;
  }
  if (score >= 40) {
    return `توقيت متوسط — يُفضّل انتظار تأكيد اختراق حجمي أو تصحيح أقرب للدعم`;
  }
  return `توقيت غير مناسب حالياً — انتظر تصحيح للدعم أو تحسّن في الزخم والحجم`;
}
